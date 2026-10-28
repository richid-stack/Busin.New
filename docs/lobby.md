# Lobby: talk to OpenLobs and hear it work

Lobby is the voice of OpenLobs. You say what you want; it does the work and tells you what it is doing as it goes, the way a person working beside you would: "Let me check which invoices are overdue." ... "Found three, all past thirty days." ... "I'm about to send a reminder to each. Shall I go ahead?" You can answer by voice. It is made to be used standing up, across a room, on a stage.

## Using it

- **Home:** press **Talk to Lobby**. **In a chat:** the sound-wave button beside Send.
- **Orb or Space:** while it listens, a tap means "that is all, send it". While it talks or works, a tap interrupts: it stops mid-sentence and listens. **Esc** leaves.
- **Approvals:** anything that changes things shows a card and is asked out loud. Say "yes" or "no", or tap Approve / Decline. Only a clear yes or no counts; anything else it asks again, and after three tries it waits for the buttons.
- **Typing:** the box at the bottom works too, for a noisy room or a browser that cannot listen.
- **Mute:** silences the voice but keeps the captions.
- **Keep listening:** by default it listens again after each answer, so you can keep talking.

## What it says

The assistant is told (only while Lobby is open) to narrate in short plain sentences: what it is about to do before each action, what it found after, then a gist of one to three sentences with "the details are on your screen". It never reads out keys, code, tables or links. All of that is `server/services/voice/persona.ts`.

On the page, `src/utils/lobbyLines.ts` turns the growing message into lines to say, one at a time, never twice:

- every complete sentence of what the assistant writes, as it arrives;
- a short phrase for an action it started without saying anything ("Searching the web.") so the room is never silent;
- the question for a decision that needs a yes or no (unless the assistant already asked it in words);
- long writing is read only up to about 400 characters, then "The rest is on your screen."

Code blocks, tables, links, emoji and anything that looks like a key are never spoken (`shared/utils/spoken.ts`). Money is said in words ("250 cedis").

## Choosing the voice

Settings, **Lobby voice**. Listening and speaking are chosen separately and every choice is optional.

| Service | Listens | Speaks | Notes |
| --- | --- | --- | --- |
| This browser | yes | yes | Free, no key. Shows your words as you speak. Chrome and Edge send the audio to their own speech service. The voice is more robotic; the list shows every voice on the device, best first. |
| Google Gemini | Gemini transcribe | 7 voices | Free tier. One key does both. |
| OpenAI | GPT-4o transcribe models, Whisper | 13 voices, three models | The mini voice follows a tone instruction (warm, unhurried). |
| Groq | Whisper large v3 (turbo) | no | The fastest listening, free tier. |
| ElevenLabs | Scribe | 6 voices, three models, or **any voice id** | The most lifelike, and a large library. |

Also: speed from 0.8x to 1.3x, a **Test voice** button, and the keep-listening switch.

If the chosen voice service fails in the middle of a talk (bad key, limit, outage), Lobby says so once and carries on with the browser's voice. It never goes quiet.

## Keys and cost

For each service Lobby looks for a key in this order:

1. a key saved for voice in Lobby settings (sealed, only the last four characters are ever shown again);
2. the key already saved for chat models (Models page) for the same service;
3. the app's own key (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `ELEVENLABS_API_KEY`), **only for Pro accounts and the accounts in `USAGE_UNLIMITED_USER_IDS`**.

Everyone else is asked to add a key. The free browser voice needs none, so Lobby is free for everyone by default. Rate limits: 240 spoken sentences and 120 recordings per person per 10 minutes.

## How it fits together

- Server: `server/services/voice/` (settings, sealed keys, key lookup, speech and listening through the AI SDK) and `server/routes/api/voice/` (`settings`, `keys`, `speak`, `transcribe`). Services are plain AI SDK models, so adding one is a line in `shared/voice.ts` and `resolve.ts`.
- Chat: `POST /api/chats/:id` takes `voice: true` while Lobby is open, which adds the narration instructions to whatever model is chosen. Lobby works with every model the chat does.
- Page: `useLobby` (listening, speaking queue with prefetch, interrupts, approvals), `LobbyStage.vue` (the screen), `useVoiceSettings`, and `LobbyVoiceSettings.vue`.
- Account export includes voice settings and which services have a key (never the key); account erase removes them.

## Not done yet

- Interrupting by voice while it is talking (today: tap or Space).
- A remote or hands-free mode that works while you are away from the screen.
- Real-voice tests against every provider: the provider calls are covered by tests with stand-in models, not by live calls.
