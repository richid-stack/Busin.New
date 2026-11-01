# The OpenLobs landing site

A small static site: `index.html`, `assets/site.css`, `assets/site.js`, `site.config.js` and `media/`. No build step, no framework, nothing to install. It deploys on its own, separate from the app.

```bash
npx serve landing        # or: python3 -m http.server -d landing 8099
```

## Before you publish

Edit **`site.config.js`** (the only file with addresses in it):

| Setting | What it does |
| --- | --- |
| `appUrl` | Where the running app lives, for example `https://app.example.com`. While it is empty, every "Open OpenLobs" button jumps to the "Run it" section instead. The footer's Privacy and Terms links point at `appUrl/privacy` and `appUrl/terms`. |
| `github` | The repository address. Change it here if the repository is renamed. |

Host it anywhere that serves files: Cloud Storage with a load balancer, Firebase Hosting (a second site), Cloudflare Pages, GitHub Pages. Give `media/` long cache lifetimes; the file names change when the content does.

## What is on the page

Outcomes first (ask, know it worked, stay in charge), then each real part of the app with its own screens and a short clip: Chat, Tasks, Workflow Studio, Agents / skills / memory, the Reef, Computers and the Bridge, Integrations and MCP, Models. After those come the trust rules, ten videos, a light / dark / phone gallery, the "free to start, open source, your keys, your computer" section with the install commands, an honest status table taken from the README, and the FAQ.

**Nothing on the page is invented.** Parts that are early (the Bridge, the Reef) or new (your own keys, voice) say so. Prices are not stated, no licence is named, and one-command Docker setup is described as planned. `tests/landing.test.mts` guards all of this, plus missing files, alt text, image sizes and total weight.

## The media, and where it comes from

| Folder | What | In git? |
| --- | --- | --- |
| `media/shots/` | 42 screenshots (light, dark, phone) as WebP | yes (about 4 MB) |
| `media/video/` | Ten web videos (720p H.264 with sound) and their posters | yes (about 10 MB) |
| `media/og.jpg` | Share image | yes |
| `media/master/`, `media/scenes/`, `media/raw/` | 1080p masters, edited scenes, raw recordings | no (large; rebuilt from `capture/`) |

### Disclosure

The app footage is the **real app, running on sample content**. A sample account stands in for sign-in, a scripted model supplies the words (so every take is identical), and an in-memory database holds the sample chats, tasks and agents. The pages, clicks, typing, streaming, tool trace, approvals and task checks are the app's own code. The Windows installer and terminal steps in the tutorials are **illustrated cards** (the commands are the ones in the README); nothing there pretends to be a recording of a real machine.

### Rebuilding it (`capture/`)

The capture rig runs the app's real server routes in-process with a fake Firestore, so no accounts or keys are needed.

```bash
CAPTURE_PORT=3000 npx tsx landing/capture/server.mts   # the app on sample content (wait ~45 s, then open every page once)
node landing/capture/shots.cjs                        # screenshots -> media/shots
node landing/capture/film.cjs                         # scripted recordings -> media/raw
node landing/capture/stage.cjs intro montage outro tag tut_install tut_bridge_a tut_bridge_b tut_keys   # motion scenes
python3 landing/capture/edit.py <scene names>         # edit footage into scenes (zoom, speed, captions, transitions)
python3 landing/capture/assemble.py ad-main intro chat_ad approval_ad tasks_ad workflow_ad agents reef_ad computers integrations montage outro
```

Needs Node 22, Playwright (Chromium), ffmpeg, Python 3 with numpy, scipy and Pillow. The soundtrack (`capture/music.py`) is synthesized from scratch, 120 bpm, so every cut lands on a beat.

### Swapping in your own recordings

Keep the file names. Replace `media/video/<name>.mp4` (and `<name>.webp` for the poster) and the page picks them up. A real recording of the Windows installer would replace `tutorial-bridge.mp4`; if you do that, change the "illustrated" note under the videos section and in the FAQ.
