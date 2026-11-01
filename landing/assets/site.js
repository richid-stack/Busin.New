(() => {
  const cfg = window.OPENLOBS || {}
  document.documentElement.classList.add('js')
  const $ = (s, r = document) => r.querySelector(s)
  const $$ = (s, r = document) => [...r.querySelectorAll(s)]
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

  // Links: the app and the repository come from site.config.js. Empty app address = jump to "Run it".
  const join = (base, path) => base.replace(/\/$/, '') + (path || '')
  $$('[data-app]').forEach(a => { if (cfg.appUrl) { a.href = join(cfg.appUrl, a.dataset.app === '' ? '/' : a.dataset.app); a.rel = 'noopener' } })
  $$('[data-github]').forEach(a => { if (cfg.github) { a.href = join(cfg.github, a.dataset.github); a.target = '_blank'; a.rel = 'noopener' } })
  if (cfg.github) { const r = $('[data-repo]'); if (r) r.textContent = cfg.github + '.git' }

  // Header turns solid after the first scroll.
  const nav = $('#nav'); const onScroll = () => nav.classList.toggle('solid', scrollY > 12)
  onScroll(); addEventListener('scroll', onScroll, { passive: true })

  // Reveal on scroll.
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }), { rootMargin: '0px 0px -8% 0px' }) : null
  $$('.reveal').forEach(el => io ? io.observe(el) : el.classList.add('in'))

  // The hero tour plays silently while it is on screen (not for reduced motion or data saving).
  const hv = $('#heroVideo'); const save = navigator.connection && navigator.connection.saveData
  if (hv && !reduce && !save && io) {
    new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) hv.play().catch(() => {}); else hv.pause() }), { threshold: .35 }).observe(hv)
  }

  // Video dialog.
  const dlg = $('#vmodal'), vp = $('#vplayer'), vt = $('#vtitle'); let opener = null
  const close = () => { vp.pause(); vp.removeAttribute('src'); vp.load(); dlg.close() }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-video]'); if (!b) return
    opener = b; vp.poster = b.dataset.poster || ''; vp.src = b.dataset.video; vt.textContent = b.dataset.title || ''
    dlg.showModal(); vp.play().catch(() => {})
  })
  $('.vclose').addEventListener('click', close)
  dlg.addEventListener('click', e => { if (e.target === dlg) close() })
  dlg.addEventListener('close', () => { vp.pause(); if (opener) opener.focus() })

  // Gallery.
  const SHOTS = {
    desk: [['home', 'Home'], ['chat-trace', 'Chat with tools'], ['chat-chart', 'A chart in chat'], ['tasks', 'Tasks'], ['workflow-canvas', 'Workflow canvas'], ['agents', 'Agents'], ['memory', 'Memory'], ['integrations', 'Integrations'], ['computers', 'Computers'], ['models', 'Models'], ['reef', 'The Reef'], ['reef-project', 'A Reef project']],
    phone: [['m-home', 'Home'], ['m-chat-trace', 'Chat'], ['m-tasks', 'Tasks'], ['m-reef', 'The Reef']]
  }
  const gal = $('#gal')
  const draw = mode => {
    gal.dataset.mode = mode
    const list = mode === 'phone' ? SHOTS.phone : SHOTS.desk, theme = mode === 'dark' ? 'dark' : 'light', phone = mode === 'phone'
    gal.innerHTML = list.map(([id, label]) => `<figure><div class="frame"><img loading="lazy" src="media/shots/${id}-${phone ? 'light' : theme}.webp" width="${phone ? 1170 : 2880}" height="${phone ? 2532 : 1800}" alt="${label}, ${phone ? 'on a phone' : theme + ' theme'}"></div><figcaption>${label}</figcaption></figure>`).join('')
  }
  $$('.tabs button').forEach(b => b.addEventListener('click', () => { $$('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b)); draw(b.dataset.tab) }))
  draw('light')

  // Copy the install commands.
  const cb = $('.copy-btn'); if (cb) cb.addEventListener('click', async () => {
    const text = $('.code code').innerText
    try { await navigator.clipboard.writeText(text); cb.textContent = 'Copied' } catch { cb.textContent = 'Press Ctrl+C' }
    setTimeout(() => cb.textContent = 'Copy', 1800)
  })
})()
