import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const css = readFileSync('src/assets/css/main.css', 'utf8')
const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)])
const vue = walk('src').filter(f => f.endsWith('.vue'))
const read = (f: string) => readFileSync(f, 'utf8')

// ---- The motion rules are in one place and respect the person's settings ----
assert(/--motion-fast:\s*120ms/.test(css) && /--motion-base:\s*200ms/.test(css) && /--motion-slow:\s*320ms/.test(css), 'three motion timings are defined once')
const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
assert(reduced.includes('animation-duration: 0.01ms !important') && reduced.includes('transition-duration: 0.01ms !important'), 'reduced motion switches animations and transitions off')
assert(reduced.includes('.animate-spin') && /infinite/.test(reduced), 'a spinner keeps turning with reduced motion (it is information)')
assert(/button\[data-slot="base"\]:not\(:disabled\):active/.test(css) && /scale\(0\.97\)/.test(css), 'buttons give a little when pressed')
assert(/\.show-late\s*\{[^}]*animation:[^}]*250ms/.test(css), 'loaders wait before showing so quick loads never flash one')
assert(!/page-enter|page-leave/.test(css) && !vue.some(f => /<Transition[^>]*name="page"/.test(read(f))), 'pages are not wrapped in a Vue transition (it blanks async pages); the arrival is a plain animation')
assert(/\.page-host\s*>\s*\*\s*\{[^}]*animation:\s*page-in/.test(css) && read('src/layouts/default.vue').includes('page-host'), 'a page arrives with a short rise')

// ---- Every list page says the same thing the same way ----
const handRolled = vue.filter(f => /class="rounded-2xl border (border-default bg-elevated\/50 p-8|border-dashed border-default p-10) text-center"/.test(read(f)) && !f.endsWith('StateCard.vue'))
assert(handRolled.length === 0, `no page draws its own sign-in / error / empty card (${handRolled.join(', ') || 'none'})`)
const spinnerOnly = vue.filter(f => f.includes('/pages/') && /class="py-12 flex justify-center"[\s\S]{0,120}animate-spin/.test(read(f)))
assert(spinnerOnly.length === 0, `no list page waits behind a bare spinner (${spinnerOnly.join(', ') || 'none'})`)
for (const f of vue.filter(f => read(f).includes('<StateCard'))) assert(/import StateCard from/.test(read(f)), `${f} imports StateCard`)
for (const f of vue.filter(f => read(f).includes('<PageSkeleton'))) assert(/import PageSkeleton from/.test(read(f)), `${f} imports PageSkeleton`)

// ---- The app does not go blank ----
const layout = read('src/layouts/default.vue')
assert(/<ErrorBoundary>[\s\S]*<RouterView[\s\S]*<\/ErrorBoundary>/.test(layout), 'a failing page is caught inside the layout, so the sidebar stays')
const boundary = read('src/components/state/ErrorBoundary.vue')
assert(boundary.includes('onErrorCaptured') && boundary.includes('reportClientError') && /return true/.test(boundary) && /return false/.test(boundary), 'the boundary reports what it catches and lets click-handler errors through')
assert(/watch\(\(\) => route\.fullPath/.test(boundary), 'going somewhere else clears the error')
assert(read('src/App.vue').includes('useOnlineNotice()') && read('src/composables/useOnlineNotice.ts').includes('useOnline'), 'losing the connection is said out loud')
assert(read('src/pages/[...path].vue').includes('goBack'), 'the 404 page can go back')
assert(read('src/components/reef/PostItem.vue').includes('touched') && read('src/pages/reef/[owner]/[repo].vue').includes('starTouched'), 'likes and stars pop for the press, not on every page load')
