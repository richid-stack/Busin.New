/* OpenLobs alerts. This worker only shows alerts and opens the right page when one is tapped.
   It does not cache anything and does not touch the app's own requests. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }
  const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 80) : 'OpenLobs'
  const options = {
    body: typeof data.body === 'string' ? data.body.slice(0, 200) : '',
    tag: typeof data.tag === 'string' ? data.tag.slice(0, 200) : undefined,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: typeof data.url === 'string' ? data.url : '/' }
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // Only a path inside the app is followed, so an alert can never send anyone to another site.
  const raw = event.notification.data && event.notification.data.url
  const path = typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
  const target = new URL(path, self.location.origin).href
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of open) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        await client.focus()
        if ('navigate' in client) return client.navigate(target).catch(() => {})
        return undefined
      }
    }
    return self.clients.openWindow(target)
  })())
})
