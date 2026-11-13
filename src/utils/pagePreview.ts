import { completePage } from '../../shared/pageHtml'

/**
 * What the preview runs under. The page is shown in an iframe with `sandbox="allow-scripts"` and nothing else: no access to
 * OpenLobs, its cookies or its storage, no forms, no pop-ups, no leaving the page. On top of that this content policy
 * stops the page loading anything from the internet, so what you see is what you download.
 */
const POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data:',
  "form-action 'none'",
  "base-uri 'none'"
].join('; ')

/** Links inside the preview stay inside it: a "#section" link scrolls, any other link does nothing. Forms do not submit. */
const GUARD = `<script>document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a');if(!a)return;e.preventDefault();var h=a.getAttribute('href')||'';if(h.length>1&&h.charAt(0)==='#'){try{var t=document.getElementById(decodeURIComponent(h.slice(1)));if(t)t.scrollIntoView({behavior:'smooth'})}catch(_){}}},true);document.addEventListener('submit',function(e){e.preventDefault()},true)</script>`

/** The document for the iframe: the policy comes first so nothing in the page can run before it applies. */
export function previewDocument(html: string, title: string): string {
  const whole = completePage(html, title)
  const guard = `<meta http-equiv="Content-Security-Policy" content="${POLICY}">${GUARD}`
  const open = /<html[^>]*>/i.exec(whole)
  if (!open) return `${guard}${whole}`
  const at = open.index + open[0].length
  return `${whole.slice(0, at)}<head>${guard}</head>${whole.slice(at)}`
}
