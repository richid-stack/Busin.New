import { BROWSER_LIMITS, SENSITIVE_FIELD } from './model'

/**
 * The script that reads a page for the assistant. It runs inside the page, tags every control the assistant may use with
 * a number (`data-olref`), and returns the controls and the visible text. Kept as plain JavaScript in a string so no build
 * step can rewrite it on the way into the browser.
 *
 * Only controls that are really on the page are numbered: hidden, zero-size and aria-hidden things are skipped, so the
 * assistant cannot be offered a button the person could not see.
 */
const SCRIPT = String.raw`(function (args) {
  var MAX = args.maxElements, MAXTEXT = args.maxText, NAME = args.nameChars;
  var sensitive = new RegExp(args.sensitive, 'i');
  var SEL = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=switch],[role=combobox],[role=option],[role=textbox],[contenteditable=""],[contenteditable="true"],[onclick]';
  var vw = window.innerWidth, vh = window.innerHeight;
  var clean = function (s) { return String(s || '').replace(/\s+/g, ' ').trim(); };
  var cut = function (s, n) { s = clean(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  function visible(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.getAttribute('aria-hidden') === 'true' || n.hasAttribute('inert') || n.hidden) return false;
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (n === el && Number(cs.opacity) === 0) return false;
    }
    var r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }
  function label(el) {
    var t = '';
    var by = el.getAttribute('aria-labelledby');
    if (by) t = by.split(/\s+/).map(function (id) { var x = document.getElementById(id); return x ? x.textContent : ''; }).join(' ');
    if (!clean(t)) t = el.getAttribute('aria-label') || '';
    if (!clean(t) && el.labels && el.labels.length) t = Array.prototype.map.call(el.labels, function (l) { var c = l.cloneNode(true); var inner = c.querySelectorAll('select,textarea,input,button'); for (var q = 0; q < inner.length; q++) inner[q].remove(); return c.textContent; }).join(' ');
    if (!clean(t)) {
      var tag = el.tagName;
      if (tag === 'INPUT' && /^(submit|button|reset)$/i.test(el.type)) t = el.value;
      else if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') t = el.getAttribute('placeholder') || el.getAttribute('title') || el.name || '';
      else t = el.innerText || el.textContent || '';
    }
    if (!clean(t)) { var img = el.querySelector && el.querySelector('img[alt]'); if (img) t = img.getAttribute('alt'); }
    if (!clean(t)) t = el.getAttribute('title') || '';
    return cut(t, NAME);
  }
  function roleOf(el) {
    var r = el.getAttribute('role');
    if (r) return r;
    var tag = el.tagName;
    if (tag === 'A') return 'link';
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'INPUT') {
      var t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (/^(submit|button|reset|image)$/.test(t)) return 'button';
      return 'textbox';
    }
    return el.isContentEditable ? 'textbox' : 'button';
  }
  function inSearch(el) {
    if (el.closest('[role=search]')) return true;
    var f = el.form || el.closest('form');
    if (el.type === 'search') return true;
    if (f) {
      var a = (f.getAttribute('action') || '') + ' ' + (f.getAttribute('role') || '') + ' ' + (f.id || '') + ' ' + (f.className && f.className.baseVal === undefined ? f.className : '');
      if (/search|query|find/i.test(a)) return true;
    }
    if (/^(q|query|search|s|keyword|keywords)$/i.test(el.name || '')) return true;
    return /\b(search|find|filter|look up)\b/i.test(label(el) + ' ' + (el.getAttribute('placeholder') || ''));
  }

  // Asked only for one control's name now: used to be sure a step lands on the same control that was seen.
  if (args.nameOf) { var one = document.querySelector('[data-olref="' + args.nameOf + '"]'); return one ? label(one) : null; }
  var old = document.querySelectorAll('[data-olref]');
  for (var i = 0; i < old.length; i++) old[i].removeAttribute('data-olref');

  var found = [];
  var all = document.querySelectorAll(SEL);
  for (var j = 0; j < all.length; j++) {
    var el = all[j];
    if (el.tagName === 'INPUT' && el.type === 'hidden') continue;
    if (!visible(el)) continue;
    var r = el.getBoundingClientRect();
    var inView = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    found.push({ el: el, inView: inView, order: j });
  }
  var pick = found.filter(function (f) { return f.inView; });
  if (pick.length < MAX) pick = pick.concat(found.filter(function (f) { return !f.inView; }).slice(0, MAX - pick.length));
  pick = pick.slice(0, MAX).sort(function (a, b) { return a.order - b.order; });

  var elements = [];
  var hasPassword = false;
  for (var k = 0; k < pick.length; k++) {
    var e = pick[k].el, ref = k + 1;
    e.setAttribute('data-olref', String(ref));
    var tag = e.tagName, type = tag === 'INPUT' ? (e.type || 'text').toLowerCase() : undefined;
    var name = label(e);
    var item = { ref: ref, role: roleOf(e), name: name, inView: pick[k].inView };
    if (type && type !== 'text') item.type = type;
    else if (tag === 'BUTTON') item.type = (e.type || 'submit').toLowerCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      var isSens = type === 'password' || /(^|\s)(cc-|one-time-code|current-password|new-password)/i.test(e.getAttribute('autocomplete') || '') || sensitive.test(name + ' ' + (e.name || '') + ' ' + (e.id || ''));
      if (type === 'password') hasPassword = true;
      if (isSens) item.sensitive = true;
      else if (type === 'checkbox' || type === 'radio') item.checked = Boolean(e.checked);
      else if (tag === 'SELECT') { item.value = cut(e.value, 80); item.options = Array.prototype.slice.call(e.options, 0, 25).map(function (o) { return cut(o.text, 60); }); }
      else if (e.value) item.value = cut(e.value, 120);
      if (e.required) item.required = true;
    } else if (e.getAttribute('role') === 'checkbox' || e.getAttribute('role') === 'switch') {
      item.checked = e.getAttribute('aria-checked') === 'true';
    }
    if (e.disabled || e.getAttribute('aria-disabled') === 'true') item.disabled = true;
    if (tag === 'A' && e.href) { try { var u = new URL(e.href); item.href = (u.origin + u.pathname).slice(0, 140); } catch (x) {} }
    if (e.closest('form')) item.inForm = true;
    if (inSearch(e)) item.inSearch = true;
    elements.push(item);
  }

  var active = document.activeElement;
  var focus = { ref: null, inSearch: false, inForm: false };
  if (active && active !== document.body) {
    var fr = active.getAttribute && active.getAttribute('data-olref');
    focus.ref = fr ? Number(fr) : null;
    focus.inForm = Boolean(active.closest && active.closest('form'));
    focus.inSearch = Boolean(active.closest && inSearch(active));
  }

  var body = document.body;
  var text = clean(body ? body.innerText : '');
  var truncated = text.length > MAXTEXT;
  var frames = Array.prototype.map.call(document.querySelectorAll('iframe'), function (f) { return (f.src || '') + ' ' + (f.title || ''); }).join(' ');
  var captcha = /recaptcha|hcaptcha|turnstile|challenges\.cloudflare|arkoselabs|funcaptcha/i.test(frames) ||
    /verify (that )?you('| a)re (a )?human|are you a robot|i'm not a robot|complete the security check|checking your browser before/i.test(text.slice(0, 1500));
  var max = Math.max(0, Math.round(Math.max(document.documentElement.scrollHeight, body ? body.scrollHeight : 0) - vh));

  return {
    url: location.href,
    title: cut(document.title, 160),
    elements: elements,
    text: truncated ? text.slice(0, MAXTEXT) : text,
    truncated: truncated || found.length > pick.length,
    scroll: { y: Math.round(window.scrollY), max: max },
    focus: focus,
    hasPassword: hasPassword,
    blocker: captcha ? 'captcha' : (hasPassword ? 'login' : null)
  };
})`

/** The arguments the script takes, so the caller passes exactly what it expects. */
export const snapshotArgs = () => ({
  maxElements: BROWSER_LIMITS.maxElements,
  maxText: BROWSER_LIMITS.maxTextChars,
  nameChars: BROWSER_LIMITS.nameChars,
  sensitive: SENSITIVE_FIELD.source
})

/** The expression to hand to `page.evaluate`: the function and its arguments, as one string. */
export const snapshotExpression = () => `${SCRIPT}(${JSON.stringify(snapshotArgs())})`

/** The expression that returns the current name of one numbered control, worked out the same way as when it was numbered. */
export const nameExpression = (ref: number) => `${SCRIPT}(${JSON.stringify({ ...snapshotArgs(), nameOf: ref })})`
