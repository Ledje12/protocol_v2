import {
  cleanupOutdatedCaches,
  precacheAndRoute,
} from 'workbox-precaching'

/* =========================================================
   PROTOCOL
   SERVICE WORKER
   ========================================================= */

/*
 * Nettoie les anciens caches générés
 * par les versions précédentes du SW.
 */
cleanupOutdatedCaches()

/*
 * VitePWA remplace automatiquement
 * self.__WB_MANIFEST au moment du build.
 */
precacheAndRoute(self.__WB_MANIFEST)


/* =========================================================
   PUSH
   ========================================================= */

self.addEventListener('push', (event) => {
  let data = {}

  try {
    data = event.data
      ? event.data.json()
      : {}
  } catch (error) {
    console.error(
      'PROTOCOL PUSH PAYLOAD ERROR:',
      error
    )

    data = {
      title: 'PROTOCOL',
      body: 'Une invitation t’attend.',
    }
  }

  const title =
    data.title || 'PROTOCOL'

  const options = {
    body:
      data.body ||
      'Une invitation t’attend.',

    icon:
      data.icon ||
      '/pwa-192x192.png',

    badge:
      data.badge ||
      '/pwa-192x192.png',

    tag:
      data.tag ||
      'protocol-notification',

    renotify: true,

    data: {
      url:
        data.url ||
        '/',
    },
  }

  event.waitUntil(
    self.registration.showNotification(
      title,
      options
    )
  )
})


/* =========================================================
   NOTIFICATION CLICK
   ========================================================= */

self.addEventListener(
  'notificationclick',
  (event) => {
    event.notification.close()

    const targetUrl =
      event.notification.data?.url ||
      '/'

    event.waitUntil(
      self.clients
        .matchAll({
          type: 'window',
          includeUncontrolled: true,
        })
        .then((clientList) => {
          for (const client of clientList) {
            if (
              'focus' in client
            ) {
              client.navigate(targetUrl)
              .catch(() => {})

              return client.focus()
            }
          }

          if (
            self.clients.openWindow
          ) {
            return self.clients.openWindow(
              targetUrl
            )
          }

          return undefined
        })
    )
  }
)