// Service Worker for Web Push Notifications
self.addEventListener("push", (event) => {
  let data = { title: "Notification", body: "", url: "/dashboard", icon: "/logo.svg", kind: "message" };
  try {
    if (event.data) data = JSON.parse(event.data.text());
  } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.badge || data.icon,
      data: { url: data.url, kind: data.kind },
      vibrate: data.kind === "meeting_invite" ? [500, 250, 500, 250, 500] : [200, 100, 200],
      requireInteraction: data.kind === "meeting_invite",
      tag: data.kind === "meeting_invite" ? `meeting-${data.meetingId || data.url}` : "grid-logic-notif",
      renotify: true,
      actions: data.kind === "meeting_invite" ? [{ action: "join", title: "Join meeting" }] : [],
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data && event.notification.data.url) || "/dashboard",
    self.location.origin
  ).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      const existing = clients.find((c) => c.url === url);
      if (existing) {
        return existing.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
