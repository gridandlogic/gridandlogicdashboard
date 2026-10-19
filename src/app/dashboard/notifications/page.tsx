"use client";

import { useRouter } from "next/navigation";
import { IconBell, IconCheck } from "@tabler/icons-react";
import { useApp } from "@/components/providers/app-provider";

export default function NotificationsPage() {
  const { notifications, unreadCount, markAllRead, markNotificationRead } = useApp();
  const router = useRouter();

  const openNotification = async (id: string, link: string | null) => {
    await markNotificationRead(id);
    router.push(link || "/dashboard");
  };

  return (
    <main className="h-full overflow-y-auto bg-neutral-950 px-4 py-6 text-white sm:px-8 sm:py-8">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between gap-4 border-b border-neutral-800 pb-5">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-950 text-cyan-300"><IconBell className="h-5 w-5" /></span>
            <div>
              <h1 className="text-xl font-semibold">Notifications</h1>
              <p className="mt-1 text-sm text-neutral-400">Messages, meeting calls and account updates</p>
            </div>
          </div>
          <button type="button" onClick={() => void markAllRead()} disabled={!unreadCount} className="flex shrink-0 items-center gap-2 rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40">
            <IconCheck className="h-4 w-4" />Mark all read
          </button>
        </header>

        <section className="divide-y divide-neutral-800">
          {notifications.length === 0 ? (
            <div className="py-16 text-center">
              <IconBell className="mx-auto h-8 w-8 text-neutral-600" />
              <p className="mt-3 font-medium">You’re all caught up</p>
              <p className="mt-1 text-sm text-neutral-500">New messages and meeting invites will appear here.</p>
            </div>
          ) : notifications.map((notification) => (
            <button key={notification.id} type="button" onClick={() => void openNotification(notification.id, notification.link)} className={`flex w-full gap-3 py-4 text-left transition hover:bg-neutral-900/70 ${notification.read ? "opacity-70" : ""}`}>
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${notification.read ? "bg-neutral-600" : "bg-cyan-400"}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{notification.title}</span>
                {notification.body && <span className="mt-1 block whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-300">{notification.body}</span>}
                <time className="mt-2 block text-xs text-neutral-500">{new Date(notification.created_at).toLocaleString()}</time>
              </span>
            </button>
          ))}
        </section>
      </div>
    </main>
  );
}