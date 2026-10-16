import type { UIMessage } from 'ai'
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, generateText, isStepCount, smoothStream, streamText, toUIMessageStream } from 'ai'
import { z } from 'zod'
import type { AnthropicLanguageModelOptions } from '@ai-sdk/anthropic'
import type { GoogleLanguageModelOptions } from '@ai-sdk/google'
import type { OpenAILanguageModelResponsesOptions } from '@ai-sdk/openai'
import { useUserSession } from '../../../utils/session'
import { getChat, updateChatTitle, saveChatMessage, saveChatMessages } from '../../../utils/firebase'
import { defineHandler } from 'nitro'
import { createError, getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { weatherTool } from '../../../utils/tools/weather'
import { chartTool } from '../../../utils/tools/chart'
import { planTool } from '../../../utils/tools/plan'
import { calculatorTool } from '../../../utils/tools/calculator'
import { webSearchTool } from '../../../utils/tools/webSearch'
import { createWorkflowCreateTool, createWorkflowRunTool, createIntegrationStatusTool, createIntegrationExecuteTool } from '../../../utils/tools/workflow'
import { MODELS } from '../../../../shared/utils/models'
import { DEFAULT_MODEL, getLanguageModel, pickAvailableModel } from '../../../utils/models'
import { enforceRateLimit, rateLimitSubject } from '../../../utils/rateLimit'
import { allowAnonymousChat, assertMessageSizes } from '../../../utils/limits'

const RATE_LIMIT_PATTERN = /quota|RESOURCE_EXHAUSTED|429|rate[ -]?limit|\bI?O?TPM\b/i

// Turns provider errors into a short, honest message; details stay in the server log.
function describeModelError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[chat] model error:', message)
  if (RATE_LIMIT_PATTERN.test(message)) {
    return 'This model has reached its rate limit. Wait a moment and try again, or pick another model from the dropdown.'
  }
  return 'Something went wrong while generating the response. Please try again.'
}

const WORKFLOW_PROMPT = `**WORKFLOWS & SERVICE AUTOMATIONS (CRITICAL):**
- You are equipped with autonomous workflow automation tools.
- When the user asks to automate tasks, create pipelines, connect Gmail/Drive/Slack, or build workflows (e.g., "Automate my inbox", "When an email comes from a client, triage it, draft a proposal and save to Drive", "Connect Gmail and Slack to notify team", "Route this to workstudio"):
  * Call the 'workflow_create' tool to construct the pipeline, generate nodes, and register it in the visual Workflow Studio!
  * Outline the steps created (Trigger -> AI Agents -> Actions) and provide a link to the Workflow Studio at /workflows.
- When the user asks to test or run an automation, call 'workflow_run'.
- When the user asks to perform tasks using multiple tools (e.g., "Read my emails and save to Drive"), ALWAYS call 'integration_status' FIRST to verify if the tools are connected. If any required tool is not connected, provide the connection links (authUrl) returned by the tool so the user can connect them before proceeding.
- When the user asks about connected accounts or service status, call 'integration_status'.
- When the user asks to connect, verify, or execute an action on an integration (e.g., GitHub, Slack, Gmail, Notion, Discord via Composio), call 'integration_execute' with the provider and instruction. If unauthenticated, the tool will return a Connect Link. You must then output this tool call so the UI renders the connection card. Do not output raw markdown links for authentication.`

const ANON_PROMPT = `**WORKFLOWS & INTEGRATIONS:**
- Workflow automation and connected apps (Gmail, Slack, Drive, ...) are available only to signed-in users. If the user asks for them, tell them to sign in first. Do not pretend to run them.`

export default defineHandler(async (event) => {
  const session = await useUserSession(event)

  const { id } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)

  const { model, messages } = await readValidatedBody(event, z.object({
    model: z.string().refine(value => MODELS.some(m => m.value === value), {
      message: 'Invalid model'
    }),
    messages: z.array(z.custom<UIMessage>())
  }).parse)

  assertMessageSizes(messages)

  const signedIn = Boolean(session.data.user?.id)
  if (!signedIn && !allowAnonymousChat()) {
    throw createError({ statusCode: 401, statusMessage: 'Sign in to chat.' })
  }

  const chat = await getChat(id)
  const userId = session.data.user?.id || session.id!
  // The model call is the expensive part, so this is where callers are throttled.
  enforceRateLimit(event, 'chat-completion', rateLimitSubject(event, signedIn ? userId : undefined), signedIn ? 40 : 12, 10 * 60_000)

  if (!chat || chat.userId !== userId) {
    throw createError({ statusCode: 404, statusMessage: 'Chat not found' })
  }

  // Extract user text for title derivation and background tasks
  const extractUserText = (msgs: UIMessage[]): string => {
    for (const msg of msgs) {
      if (msg.role === 'user') {
        if (Array.isArray(msg.parts)) {
          for (const part of msg.parts) {
            if (part && typeof part === 'object' && 'type' in part && part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
              return part.text.trim()
            }
            if (part && typeof part === 'object' && 'text' in part && typeof (part as any).text === 'string' && (part as any).text.trim()) {
              return (part as any).text.trim()
            }
          }
        }
        // Legacy messages saved before the parts format carried plain `content`.
        const legacy = (msg as { content?: unknown }).content
        if (typeof legacy === 'string' && legacy.trim()) {
          return legacy.trim()
        }
      }
    }
    return ''
  }

  const userPromptText = extractUserText(messages)
  const isGenericTitle = !chat.title || chat.title.trim() === '' || chat.title === 'Untitled' || chat.title === 'New Chat'

  if (isGenericTitle && userPromptText) {
    const initialTitle = userPromptText.replace(/^["'`]|["'`]$/g, '').replace(/\s+/g, ' ').slice(0, 36) || 'New Chat'
    chat.title = initialTitle
    updateChatTitle(id, initialTitle).catch(err => console.warn('Failed to update chat title in background:', err))
  }

  // Generate a more refined title asynchronously in the background
  if (userPromptText) {
    ;(async () => {
      try {
        let refinedTitle = ''
        const titleModelId = pickAvailableModel(DEFAULT_MODEL)
        if (titleModelId) {
          try {
            const { text } = await generateText({
              abortSignal: AbortSignal.timeout(5000),
              model: getLanguageModel(titleModelId),
              maxRetries: 0,
              instructions: 'Generate a short 2-4 word concise title for this prompt. Return ONLY plain text with NO quotes, NO punctuation, NO markdown.',
              prompt: userPromptText.slice(0, 150)
            })
            if (text && text.trim()) {
              refinedTitle = text.trim()
            }
          } catch {
            // ignore: the provisional title stays
          }
        }

        if (refinedTitle) {
          const cleanTitle = refinedTitle.replace(/^["']|["']$/g, '').slice(0, 36).trim()
          if (cleanTitle && cleanTitle !== chat.title) {
            chat.title = cleanTitle
            await updateChatTitle(id, cleanTitle)
          }
        }
      } catch (err) {
        console.warn('Background title generation failed:', err)
      }
    })()
  }

  const lastMessage = messages[messages.length - 1]
  // Existing messages keep their original timestamps when the conversation is saved again.
  const existingCreatedAt = new Map(chat.messages.map(m => [m.id, m.createdAt]))
  if (lastMessage?.role === 'user' && messages.length > 1) {
    const userCreatedAt = new Date()
    existingCreatedAt.set(lastMessage.id, userCreatedAt)
    // Save non-blocking so the stream begins immediately without delay
    saveChatMessage(id as string, {
      id: lastMessage.id,
      role: 'user',
      parts: lastMessage.parts,
      createdAt: userCreatedAt
    }).catch(err => console.warn('Non-blocking user message save error:', err))
  }

  // Retired models (e.g. old saved selections) are mapped to the default; a missing API key
  // for the chosen provider produces a clear 400 from getLanguageModel.
  const languageModel = getLanguageModel(model)

   
  let assistantFinishEvent: any = null

  // Workflow and app-integration tools act on a person's account, so they exist only for signed-in users.
  const tools = {
    chart: chartTool,
    weather: weatherTool,
    plan: planTool,
    calculator: calculatorTool,
    web_search: webSearchTool,
    ...(signedIn
      ? {
          workflow_create: createWorkflowCreateTool(userId),
          workflow_run: createWorkflowRunTool(userId),
          integration_status: createIntegrationStatusTool(userId),
          integration_execute: createIntegrationExecuteTool(userId)
        }
      : {})
  }

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      try {
        const result = streamText({
          abortSignal: event.req.signal,
          model: languageModel,
          maxRetries: 0,
          instructions: `You are a knowledgeable and helpful AI assistant. ${session.data.user?.username ? `The user's name is ${session.data.user.username}.` : ''} Your goal is to provide clear, accurate, and well-structured responses.

**FORMATTING RULES (CRITICAL):**
- ABSOLUTELY NO MARKDOWN HEADINGS: Never use #, ##, ###, ####, #####, or ######
- NO underline-style headings with === or ---
- Use **bold text** for emphasis and section labels instead
- Examples:
  * Instead of "## Usage", write "**Usage:**" or just "Here's how to use it:"
  * Instead of "# Complete Guide", write "**Complete Guide**" or start directly with content
- Start all responses with content, never with a heading

**WEB SEARCH:**
- You have access to a web search tool to find current, up-to-date information
- Only use it when the user explicitly asks about recent events, real-time data, or current facts
- Do NOT search proactively — rely on your knowledge first
- Cite your sources when providing information from web search results

**RESPONSE QUALITY:**
- Be concise yet comprehensive
- Use examples when helpful
- Break down complex topics into digestible parts
- Maintain a friendly, professional tone

${signedIn ? WORKFLOW_PROMPT : ANON_PROMPT}`,
          messages: await convertToModelMessages(messages),
          tools,
          providerOptions: {
            anthropic: {
              thinking: {
                type: 'enabled',
                budgetTokens: 1024
              }
            } satisfies AnthropicLanguageModelOptions,
            google: {
              thinkingConfig: {
                thinkingBudget: 2048,
                includeThoughts: true
              }
            } satisfies GoogleLanguageModelOptions,
            groq: {
              reasoningFormat: 'parsed'
            },
            openai: {
              reasoningEffort: 'low',
              reasoningSummary: 'detailed'
            } satisfies OpenAILanguageModelResponsesOptions
          },
          stopWhen: isStepCount(5),
          experimental_transform: smoothStream(),
          onFinish: async (event) => {
            assistantFinishEvent = event
          }
        })

        if (chat.title && chat.title !== 'Untitled') {
          writer.write({
            type: 'data-chat-title',
            data: { id: chat.id, title: chat.title }
          })
        }

        writer.merge(toUIMessageStream({
          stream: result.stream,
          sendSources: true,
          sendReasoning: true,
          onError: describeModelError
        }))

      } catch (err) {
        writer.write({ type: 'error', errorText: describeModelError(err) })
      }
    },
    onEnd: async ({ messages: finalMessages }) => {
      try {
        const finishEvent = assistantFinishEvent
        const formattedMessages = finalMessages.map(m => {
          let parts = m.parts || []
          if (m.role === 'assistant' && (!parts || parts.length === 0) && finishEvent?.text) {
            parts = [{ type: 'text', text: finishEvent.text }]
          }
          return {
            id: m.id,
            role: m.role as 'user' | 'assistant',
            parts
          }
        })
        await saveChatMessages(chat.id, formattedMessages, existingCreatedAt)
      } catch (err) {
        console.error('Error in onEnd saveChatMessages:', err)
      }
    }
  })

  return createUIMessageStreamResponse({
    stream
  })
})
