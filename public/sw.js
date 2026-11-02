/* Relegation Line service worker — web push + app-icon badge. */

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { title: "Relegation Line", body: event.data ? event.data.text() : "" }
  }
  const title = data.title || "Relegation Line"
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || "/" },
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options)
      try {
        if (self.navigator.setAppBadge) await self.navigator.setAppBadge(data.badge || 1)
      } catch (e) {
        /* badge unsupported — notification still shows */
      }
    })()
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || "/"
  event.waitUntil(
    (async () => {
      try {
        if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge()
      } catch (e) {
        /* ignore */
      }
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      for (const client of all) {
        if ("focus" in client) {
          try {
            await client.navigate(url)
          } catch (e) {
            /* cross-origin or navigation blocked — just focus */
          }
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })()
  )
})
