self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "Notification", body: "", url: "/dashboard", icon: "/logo.svg", kind: "message" };
  try { if (event.data) data = { ...data, ...JSON.parse(event.data.text()) }; } catch {}
  event.waitUntil((async () => {
    if (data.kind === "meeting_invite" && data.sentAt && Date.now() - data.sentAt > 45000) return;
    const tag = data.tag || (data.kind === "meeting_invite" ? "meeting-" + (data.meetingId || data.url) : "grid-logic-notif");
    const existing = await self.registration.getNotifications({ tag });
    const duplicate = existing.some((item) => Date.now() - (item.data?.receivedAt || 0) < 5000);
    await self.registration.showNotification(data.title, {
      body: data.body, icon: data.icon, badge: data.badge || data.icon,
      data: { url: data.url, kind: data.kind, receivedAt: Date.now() },
      vibrate: data.kind === "meeting_invite" ? [500, 250, 500, 250, 500] : [200, 100, 200],
      requireInteraction: data.kind === "meeting_invite",
      tag, renotify: !duplicate,
      actions: data.kind === "meeting_invite" ? [{ action: "join", title: "Join meeting" }] : [],
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || "/dashboard", self.location.origin);
  const url = destination.origin === self.location.origin ? destination.href : self.location.origin + "/dashboard";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => client.url === url) || windows[0];
    if (existing) {
      if (existing.url !== url) await existing.navigate(url);
      return existing.focus();
    }
    return self.clients.openWindow(url);
  })());
});
