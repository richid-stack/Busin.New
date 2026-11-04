# The OpenLobs landing site

One static page. `index.html` carries the approved design (its own styles and motion, unchanged); `site.config.js` holds the two addresses; `assets/logo.svg` is the real OpenLobs mark; `media/` holds the real screenshots, close-ups and videos. No build step, no framework, nothing to install. `index.html` is the source of truth: edit it directly. It deploys on its own, separate from the app.

```bash
npx serve landing        # or: python3 -m http.server -d landing 8099
```

## What changed from the design you sent

The layout, colours, type, spacing, cards, rows, marquees, command palette, menu, FAQ and motion engine are the file you sent. What changed is what sits inside them:

| Your design | Now |
| --- | --- |
| Drawn mock-ups (hero reel, cards, panels) | Real screen recordings and close-ups cut from real screenshots of the app |
| Catalog, validation, compatibility, versions, benchmarks, deploy to Vercel or Telegram, Blender, FL Studio, language picker, "All services online" | Removed: the app does not have them |
| Text | Rewritten to what the app does, with early and new parts labelled |
| Logo | The real lobster mark |
| Footer links and social icons | Real links only (the app, the repository, privacy, terms) |

## Before you publish

Edit **`site.config.js`** (the only file with addresses in it):

| Setting | What it does |
| --- | --- |
| `appUrl` | Where the running app lives, for example `https://app.example.com`. While it is empty, the "Start free" and "Log in" buttons jump to the "Deploy it your way" section. Privacy and Terms point at `appUrl/privacy` and `appUrl/terms`. |
| `github` | The repository address. Change it here if the repository is renamed. |

Host it anywhere that serves files: Cloud Storage with a load balancer, Firebase Hosting (a second site), Cloudflare Pages, GitHub Pages. Give `media/` long cache lifetimes.

## What is on the page

Hero recording (69 s), then Chat, Tasks, Workflows and approvals; the workspace (agents and skills, memory, apps and MCP, models, Workflow Studio, The Reef); the Bridge for your own computer; how tasks verify results; a recorded tour in six parts; three tutorials; apps, models and voice; schedules and their limits; working examples; the trust rules; The Reef; a strip of close-ups; ways to run it; FAQ.

**Nothing on the page is invented.** Parts that are early (the Bridge, The Reef) or new (your own keys, voice, schedules) say so. Prices are not stated, no licence is named, and one-command Docker setup is described as planned. `tests/landing.test.mts` guards this, plus missing files, alt text, image sizes and total weight.

## The media, and where it comes from

| Folder | What | In git? |
| --- | --- | --- |
| `media/shots/` | 42 full screenshots (light, dark, phone) as WebP | yes (about 4 MB) |
| `media/crops/` | Close-ups cut from those screenshots (`capture/crops.py`) | yes (under 1 MB) |
| `media/video/` | Ten web videos (720p H.264 with sound) and their posters | yes (about 10 MB) |
| `media/og.jpg` | Share image | yes |
| `media/master/`, `media/scenes/`, `media/raw/` | 1080p masters, edited scenes, raw recordings | no (large; rebuilt from `capture/`) |

### Disclosure

The app footage is the **real app, running on sample content**. A sample account stands in for sign-in, a scripted model supplies the words (so every take is identical), and an in-memory database holds the sample chats, tasks and agents. The pages, clicks, typing, streaming, tool trace, approvals and task checks are the app's own code. The tutorials (install, Bridge, Cloud Run deploy) are **illustrated** in a drawn code-editor window: the commands are the ones in the README and `docs/deploy.md`, and the terminal output follows the real tools' formats, but nothing there is a recording of a real machine, and the Cloud Run commands have not yet been run against a live project. The phone-to-computer sequence in the hero video is also an illustration. The Windows installer is not shown.

### Rebuilding it (`capture/`)

The capture rig runs the app's real server routes in-process with a fake Firestore, so no accounts or keys are needed.

```bash
CAPTURE_PORT=3000 npx tsx landing/capture/server.mts   # the app on sample content (wait ~45 s, then open every page once)
node landing/capture/shots.cjs                        # screenshots -> media/shots
node landing/capture/film.cjs                         # scripted recordings -> media/raw
node landing/capture/stage.cjs intro montage outro tag remote vs_install vs_bridge vs_deploy tut_keys   # motion scenes
python3 landing/capture/edit.py <scene names>         # edit footage into scenes (zoom, speed, captions, transitions)
python3 landing/capture/assemble.py ad-main intro chat_ad approval_ad tasks_ad workflow_ad agents reef_ad computers integrations montage outro
# or everything in order: landing/capture/build_all.sh
```

Needs Node 22, Playwright (Chromium), ffmpeg, Python 3 with numpy, scipy and Pillow. The soundtrack (`capture/music.py`) is synthesized from scratch, 120 bpm, so every cut lands on a beat.

### Swapping in your own recordings

Keep the file names. Replace `media/video/<name>.mp4` (and `<name>.webp` for the poster) and the page picks them up. A real recording of the Windows installer would replace `tutorial-bridge.mp4`; if you do that, change the "illustrated from the README steps" note above the tutorials.
