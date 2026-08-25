// Service Worker for Web Push Notifications
self.addEventListener("push", (event) => {
  let data = { title: "Notification", body: "", url: "/dashboard", icon: "/logo.svg" };
  try {
    if (event.data) data = JSON.parse(event.data.text());
  } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.badge || data.icon,
      data: { url: data.url },
      vibrate: [200, 100, 200],
      tag: "grid-logic-notif",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url));
      if (existing) {
        return existing.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
