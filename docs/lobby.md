# Lobby: talk to OpenLobs and hear it work

Lobby is the voice of OpenLobs. You say what you want; it does the work and tells you what it is doing as it goes, the way a person working beside you would: "Let me check which invoices are overdue." ... "Found three, all past thirty days." ... "I'm about to send a reminder to each. Shall I go ahead?" You can answer by voice. 

## Using it

Lobby is the normal chat, with a voice. There is no separate screen.

- **The waveform is where Send is.** With nothing typed, the circled waveform button beside the message box starts voice mode, and a small mic beside it dictates: speak and the words land in the box to read and send. Type a word and both become Send. On Home, the waveform starts a new chat and begins listening.
- **In voice mode the message box becomes live waves.** They follow your voice while you talk, ripple while Lobby works, and move in a different colour while it speaks. A line above them has the OpenLobs lobster, moved by real sound, the state, and the words just heard. Listening: its claws lift to its ears and tremble with how loud you are. Speaking: a mouth opens with how loud Lobby is, with sound coming out. Working: the claws tap slowly and the antennae sweep. Paused: eyes closed, claws down. With reduced motion it holds the pose and does not move. What you say goes into the chat as your message the moment you stop, and the reply comes back in the same thread and is read aloud.
- **One tap does the obvious thing.** While it listens, tap the waveform button to say "that is all". While it talks or works, tap to stop it mid-sentence; it then listens. Next to it are mute and end (Esc ends too), and the text box comes back.
- **Approvals** are the usual approval card in the chat. Say "yes" or "no", or tap Approve / Decline. Only a clear yes or no counts; anything else it asks again, and after three tries it waits for the buttons.
- **Typing:** end voice mode to type. Dictation (the small mic) works any time, with the chosen listening service.
- **Keep listening:** by default it listens again after each answer, so you can keep talking.

## What it says

**Every chat narrates its work**, spoken or not. The assistant is told to say, in one short plain sentence, what it is about to do before each action and what it found after ("Let me check which invoices are overdue." ... "Found three. Now I'm drafting the reminders."), and to just answer a simple question without narration. It is ordinary chat text between the steps, so it reads well on screen.

**Only while Lobby is on**, it is also told to keep lines speakable: short, no markup, money in words, a gist of one to three sentences with "the details are on your screen", never reading out a key. Both are in `server/services/voice/persona.ts`.

Lobby then speaks that text. On the page, `src/utils/lobbyLines.ts` turns the growing message into lines to say, one at a time, never twice:

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
- Chat: `POST /api/chats/:id` takes `voice: true` while Lobby is open, which adds the speakable-text instructions to whatever model is chosen (the narration instructions are in every chat). Lobby works with every model the chat does.
- Page: `useLobby` (listening, speaking queue with prefetch, interrupts, approvals), `PromptVoiceButton.vue` (the waveform button in Send's place), `PromptWaves.vue` (the live waves in the message box), `DictateButton.vue` and `useDictation` (the small mic), `useVoiceSettings`, and `LobbyVoiceSettings.vue`.
- Account export includes voice settings and which services have a key (never the key); account erase removes them.

## Not done yet

- With the browser's own listening, the loudness of your voice is read from a second microphone stream; on devices that cannot share the microphone that way (iPhone and iPad), the waves stay low and the lobster's claws stay still while you talk. The browser's own voice reports no loudness, so while it speaks the mouth and waves pulse with each word instead.
- Interrupting by voice while it is talking (today: tap the button).
- A remote or hands-free mode that works while you are away from the screen.
- Real-voice tests against every provider: the provider calls are covered by tests with stand-in models, not by live calls.
