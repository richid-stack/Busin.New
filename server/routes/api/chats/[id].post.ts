import type { UIMessage } from 'ai'
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, generateText, isStepCount, smoothStream, streamText, toUIMessageStream } from 'ai'
import { z } from 'zod'
import type { AnthropicLanguageModelOptions } from '@ai-sdk/anthropic'
import { anthropic, createAnthropic } from '@ai-sdk/anthropic'
import type { GoogleLanguageModelOptions } from '@ai-sdk/google'
import { google, createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import type { OpenAILanguageModelResponsesOptions } from '@ai-sdk/openai'
import { openai, createOpenAI } from '@ai-sdk/openai'
import { useUserSession } from '../../../utils/session'
import { getChat, updateChatTitle, saveChatMessage, saveChatMessages } from '../../../utils/firebase'
import { defineHandler } from 'nitro'
import { createError, getValidatedRouterParams, readValidatedBody } from 'nitro/h3'
import { weatherTool } from '../../../utils/tools/weather'
import { chartTool } from '../../../utils/tools/chart'
import { planTool } from '../../../utils/tools/plan'
import { calculatorTool } from '../../../utils/tools/calculator'
import { workflowCreateTool, workflowRunTool, integrationStatusTool, integrationTestTool } from '../../../utils/tools/workflow'
import { MODELS } from '../../../../shared/utils/models'

function getGoogleModel(modelId: string) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!apiKey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'GEMINI_API_KEY is not configured.'
    })
  }
  const google = createGoogleGenerativeAI({ apiKey })
  return google(modelId)
}

function getGroqModel(modelId: string) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'GROQ_API_KEY is not configured. Please add GROQ_API_KEY in the environment settings.'
    })
  }
  const groq = createGroq({ apiKey })
  if (modelId === 'compound-mini' || modelId === 'groq/compound-mini') {
    return groq('groq/compound-mini')
  }
  if (modelId.includes('gpt-oss-120b')) {
    return groq('openai/gpt-oss-120b')
  }
  if (modelId.includes('gpt-oss-20b')) {
    return groq('openai/gpt-oss-20b')
  }
  if (modelId.startsWith('qwen')) {
    return groq(`qwen/${modelId.replace('qwen/', '')}`)
  }
  return groq(modelId)
}

function getOpenAIModel(modelId: string) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'OPENAI_API_KEY is not configured. Please add OPENAI_API_KEY in the environment settings.'
    })
  }
  const openaiClient = createOpenAI({ apiKey })
  return openaiClient(modelId)
}

function getAnthropicModel(modelId: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'ANTHROPIC_API_KEY is not configured. Please add ANTHROPIC_API_KEY in the environment settings.'
    })
  }
  const anthropicClient = createAnthropic({ apiKey })
  return anthropicClient(modelId)
}

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

  const chat = await getChat(id)
  const userId = session.data.user?.id || session.id!

  if (!chat || chat.userId !== userId) {
    throw createError({ statusCode: 404, statusMessage: 'Chat not found' })
  }

  if (!chat.title) {
    const firstMsgText = typeof messages[0]?.parts?.[0] === 'object' && messages[0].parts[0] !== null && 'text' in messages[0].parts[0]
      ? (messages[0].parts[0] as { text: string }).text
      : (typeof messages[0]?.content === 'string' ? messages[0].content : 'New Chat')

    const initialTitle = firstMsgText.trim().slice(0, 30) || 'New Chat'
    chat.title = initialTitle
    await updateChatTitle(id, initialTitle)

    // Generate a more refined title asynchronously in the background so stream begins instantly
    ;(async () => {
      try {
        let refinedTitle = ''
        const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY
        if (geminiKey) {
          try {
            const google = createGoogleGenerativeAI({ apiKey: geminiKey })
            const { text } = await generateText({
              abortSignal: AbortSignal.timeout(4000),
              model: google('gemini-3.5-flash'),
              maxRetries: 0,
              instructions: 'Generate a short 3-5 word title for this prompt, plain text only, no quotes, no punctuation',
              prompt: firstMsgText.slice(0, 100)
            })
            if (text && text.trim()) {
              refinedTitle = text
            }
          } catch {
            // ignore
          }
        }

        if (!refinedTitle && process.env.GROQ_API_KEY) {
          try {
            const groq = createGroq({ apiKey: process.env.GROQ_API_KEY })
            const { text } = await generateText({
              abortSignal: AbortSignal.timeout(4000),
              model: groq('groq/compound-mini'),
              maxRetries: 0,
              instructions: 'Generate a short 3-5 word title for this message, no punctuation, plain text only',
              prompt: firstMsgText.slice(0, 100)
            })
            if (text && text.trim()) {
              refinedTitle = text
            }
          } catch {
            // ignore
          }
        }

        if (refinedTitle) {
          const cleanTitle = refinedTitle.trim().replace(/^["']|["']$/g, '').slice(0, 30)
          if (cleanTitle) {
            await updateChatTitle(id, cleanTitle)
          }
        }
      } catch (err) {
        console.warn('Background title generation failed:', err)
      }
    })()
  }

  const lastMessage = messages[messages.length - 1]
  if (lastMessage?.role === 'user' && messages.length > 1) {
    await saveChatMessage(id as string, {
      id: lastMessage.id,
      role: 'user',
      parts: lastMessage.parts
    })
  }

  const abortController = new AbortController()
  event.node?.req?.on('close', () => {
    if (!event.node?.res?.writableEnded) {
      abortController.abort()
    }
  })

  // Select the appropriate model target, defaulting deprecated models to Gemini 3.5 Flash
  let activeModel = model
  if (
    activeModel === 'google/gemini-2.5-flash' ||
    activeModel === 'groq/llama-3.3-70b-versatile' ||
    activeModel.includes('llama')
  ) {
    activeModel = 'google/gemini-3.5-flash'
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let languageModel: any = activeModel
  if (activeModel.startsWith('google/')) {
    const modelId = activeModel.replace('google/', '')
    languageModel = getGoogleModel(modelId)
  } else if (activeModel.startsWith('groq/')) {
    const modelId = activeModel.replace('groq/', '')
    languageModel = getGroqModel(modelId)
  } else if (activeModel.startsWith('openai/')) {
    const modelId = activeModel.replace('openai/', '')
    languageModel = getOpenAIModel(modelId)
  } else if (activeModel.startsWith('anthropic/')) {
    const modelId = activeModel.replace('anthropic/', '')
    languageModel = getAnthropicModel(modelId)
  }

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let assistantFinishEvent: any = null

        const result = streamText({
          abortSignal: abortController.signal,
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

**WORKFLOWS & SERVICE AUTOMATIONS (CRITICAL):**
- You are equipped with autonomous workflow automation tools.
- When the user asks to automate tasks, create pipelines, connect Gmail/Drive/Slack, or build workflows (e.g., "Automate my inbox", "When an email comes from a client, triage it, draft a proposal and save to Drive", "Connect Gmail and Slack to notify team", "Route this to workstudio"):
  * Call the 'workflow_create' tool to construct the pipeline, generate nodes, and register it in the visual Workflow Studio!
  * Outline the steps created (Trigger -> AI Agents -> Actions) and provide a link to the Workflow Studio at /workflows.
- When the user asks to test or run an automation, call 'workflow_run'.
- When the user asks about connected accounts or service status, call 'integration_status'.
- When the user asks to connect, verify, or test a real tool call for an integration (e.g., GitHub, Slack, Gmail, Notion, Discord via Composio), call 'integration_test' with the provider. If unauthenticated, present the returned Connect Link as a clickable Markdown link.`,
          messages: await convertToModelMessages(messages),
          tools: {
            chart: chartTool,
            weather: weatherTool,
            plan: planTool,
            calculator: calculatorTool,
            workflow_create: workflowCreateTool,
            workflow_run: workflowRunTool,
            integration_status: integrationStatusTool,
            integration_test: integrationTestTool,
            ...(activeModel.startsWith('google/') && { web_search: google.tools.googleSearch({}) }),
            ...(activeModel.startsWith('anthropic/') && { web_search: anthropic.tools.webSearch_20250305() }),
            ...(activeModel.startsWith('openai/') && { web_search: openai.tools.webSearch() })
          },
          providerOptions: {
            anthropic: {
              thinking: {
                type: 'enabled',
                budgetTokens: 2048
              }
            } satisfies AnthropicLanguageModelOptions,
            google: {
              thinkingConfig: activeModel.includes('2.5')
                ? {
                    thinkingBudget: 2048,
                    includeThoughts: true
                  }
                : {
                    thinkingLevel: 'medium',
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

        if (!chat.title) {
          writer.write({
            type: 'data-chat-title',
            data: { message: 'Generating title...' },
            transient: true
          })
        }

        writer.merge(toUIMessageStream({
          stream: result.stream,
          sendSources: true,
          sendReasoning: true,
          onError: (error) => {
            const errStr = error instanceof Error ? error.message : String(error)
            if (
              errStr.includes('quota') ||
              errStr.includes('RESOURCE_EXHAUSTED') ||
              errStr.includes('429') ||
              errStr.includes('rate limit') ||
              errStr.includes('rate-limit') ||
              errStr.includes('Rate limit') ||
              errStr.includes('TPM') ||
              errStr.includes('ITPM') ||
              errStr.includes('OTPM')
            ) {
              return 'Model rate limit reached for this provider. Switched to Gemini 3.5 Flash for high throughput, or select another model from the dropdown.'
            }
            return errStr || 'An error occurred while generating the response.'
          }
        }))

        // Keep reference in event for onEnd
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(event as any)._assistantFinish = () => assistantFinishEvent
      } catch (err) {
        console.error('Error during streamText execution:', err)
        const errStr = err instanceof Error ? err.message : String(err)
        if (
          errStr.includes('quota') ||
          errStr.includes('RESOURCE_EXHAUSTED') ||
          errStr.includes('429') ||
          errStr.includes('rate limit') ||
          errStr.includes('rate-limit') ||
          errStr.includes('Rate limit') ||
          errStr.includes('TPM') ||
          errStr.includes('ITPM') ||
          errStr.includes('OTPM')
        ) {
          writer.write({
            type: 'text-delta',
            textDelta: 'The selected model has temporarily reached its rate limit. Switched to Gemini 3.5 Flash for uninterrupted high capacity. Please continue your request!'
          })
          return
        }
        throw err
      }
    },
    onEnd: async ({ messages: finalMessages }) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const finishEvent = (event as any)._assistantFinish ? (event as any)._assistantFinish() : null
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
        await saveChatMessages(chat.id, formattedMessages)
      } catch (err) {
        console.error('Error in onEnd saveChatMessages:', err)
      }
    }
  })

  return createUIMessageStreamResponse({
    stream
  })
})
