# UX and motion

One set of rules, so the app feels like one product. The numbers follow common practice (Atlassian's motion guidance: fast for small frequent things, slower for larger ones, exits quicker than entrances, nothing that blocks the next step).

## Motion (`src/assets/css/main.css`)
- Timings: fast 120 ms (press, hover), base 200 ms (a page or card arriving), slow 320 ms (things appearing inside a page). Curves: `--ease-out`, `--ease-in`, `--ease-spring`.
- Buttons give a little (scale 0.97) when pressed and spring back.
- A page arrives with a short rise and fade (`.page-host > *`). It is a plain CSS animation, not a Vue `<Transition>`: a transition that waits for the old page to leave left async pages blank in testing.
- `.rise-in`, `.pop` and `.show-late` are there for things inside a page. A like or star pops only for the person's own press, not for every liked item when a page loads.
- With "reduce motion" on, everything becomes instant. Spinners keep turning, because they tell the person something is happening.

## States (`src/components/state/`)
- `StateCard`: the one card for "sign in", "could not load" and "nothing here yet". Same tile and spacing as before, used by every list page.
- `PageSkeleton`: what a list shows while loading, in the shape of what is coming. It appears only after about a quarter of a second, so a quick load never flashes it.
- `PendingScreen`: the loader for a whole page or the app, with the same delay.
- `ErrorBoundary`: a page that fails while it is built or drawn shows a short explanation with Try again and Reload, the sidebar and chats keep working, and the error is reported. A failing click handler is not treated this way.
- Offline: one message when the connection drops and one when it is back.
- 404: a short arrival and a Go back button (home if the page was opened directly).

## Not changed on purpose
Chat message animation (Nuxt UI's chat already scrolls and streams; re-animating on re-render risks flicker), and any new look: every piece reuses the existing tiles, borders and type.
