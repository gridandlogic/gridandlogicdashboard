"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useApp } from "@/components/providers/app-provider";
import { formatDate, formatTime } from "@/lib/utils";
import { IconBell, IconBellRinging } from "@tabler/icons-react";

export default function NotificationsPage() {
  const { notifications, markAllRead } = useApp();

  useEffect(() => {
    const t = setTimeout(() => markAllRead(), 1500);
    return () => clearTimeout(t);
  }, [markAllRead]);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-4 md:p-10">
      <div className="flex items-center gap-2">
        <IconBellRinging className="h-6 w-6 text-cyan-400" />
        <h1 className="text-2xl font-bold text-neutral-800 dark:text-white">
          Notifications
        </h1>
      </div>

      <div className="mt-6 flex flex-col gap-2">
        {notifications.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-20 text-neutral-500">
            <IconBell className="h-10 w-10" />
            <p>No notifications yet.</p>
          </div>
        )}
        {notifications.map((n) => {
          const inner = (
            <div
              className={`rounded-lg border p-4 transition ${
                n.read
                  ? "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800"
                  : "border-cyan-500/40 bg-cyan-500/5 dark:bg-cyan-500/10"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-neutral-800 dark:text-white">
                  {n.title}
                </p>
                <span className="shrink-0 text-xs text-neutral-500">
                  {formatDate(n.created_at)} · {formatTime(n.created_at)}
                </span>
              </div>
              {n.body && (
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  {n.body}
                </p>
              )}
            </div>
          );
          return n.link ? (
            <Link key={n.id} href={n.link}>
              {inner}
            </Link>
          ) : (
            <div key={n.id}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
