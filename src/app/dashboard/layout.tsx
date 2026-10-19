"use client";
import React, { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar, SidebarBody, SidebarLink } from "@/components/ui/sidebar";
import {
  IconLayoutDashboard,
  IconLayoutKanban,
  IconHash,
  IconMessageCircle,
  IconVideo,
  IconShieldCog,
  IconArrowLeft,
  IconBell,
  IconCheck,
} from "@tabler/icons-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { AppProvider, PushNotificationsPrompt, useApp } from "@/components/providers/app-provider";
import { MeetingCallNotification } from "@/components/meeting/meeting-call-notification";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppProvider>
      <Shell>{children}</Shell>
    </AppProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { profile, isAdmin, supabase } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = [
    {
      label: "Dashboard",
      href: "/dashboard",
      icon: <IconLayoutDashboard className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />,
    },
    {
      label: "Sprint Boards",
      href: "/dashboard/boards",
      icon: <IconLayoutKanban className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />,
    },
    {
      label: "Channels",
      href: "/dashboard/channels",
      icon: <IconHash className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />,
    },
    {
      label: "Messages",
      href: "/dashboard/dm",
      icon: <IconMessageCircle className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />,
    },
    {
      label: "Meetings",
      href: "/dashboard/meetings",
      icon: <IconVideo className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />,
    },
    ...(isAdmin
      ? [
          {
            label: "Admin",
            href: "/dashboard/admin",
            icon: <IconShieldCog className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />,
          },
        ]
      : []),
  ];

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-1 flex-col overflow-hidden bg-gray-100 md:flex-row dark:bg-neutral-800",
        "h-dvh min-h-0"
      )}
    >
      <Sidebar open={open} setOpen={setOpen}>
        <SidebarBody className="justify-between gap-10">
          <div className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
            {open ? <Logo /> : <LogoIcon />}
            <div className="mt-8 flex flex-col gap-2">
              {links.map((link, idx) => (
                <SidebarLink
                  key={idx}
                  link={link}
                  className={cn(
                    pathname === link.href && "rounded-md bg-neutral-200 px-2 dark:bg-neutral-700"
                  )}
                />
              ))}
              <button
                onClick={logout}
                className="flex items-center justify-start gap-2 group/sidebar py-2 cursor-pointer"
              >
                <IconArrowLeft className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />
                {open && (
                  <span className="text-neutral-700 dark:text-neutral-200 text-sm whitespace-pre">
                    Logout
                  </span>
                )}
              </button>
            </div>
          </div>
          <div>
            <SidebarLink
              link={{
                label: `${profile.first_name} ${profile.last_name}`,
                href: "/dashboard/profile",
                icon: (
                  <Avatar profile={profile} />
                ),
              }}
            />
          </div>
        </SidebarBody>
      </Sidebar>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex h-full w-full flex-1 flex-col overflow-hidden rounded-tl-2xl border border-neutral-200 bg-white md:rounded-tl-2xl dark:border-neutral-700 dark:bg-neutral-900">
          {children}
        </div>
      </div>
      <NotificationCenter />
      <MeetingCallNotification />
      <PushNotificationsPrompt />
    </div>
  );
}

function NotificationCenter() {
  const { notifications, unreadCount, markAllRead, markNotificationRead, latestNotification, clearLatestNotification } = useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!latestNotification) return;
    const timeout = window.setTimeout(clearLatestNotification, 8000);
    return () => window.clearTimeout(timeout);
  }, [latestNotification, clearLatestNotification]);

  const openNotification = async (id: string, link: string | null) => {
    try {
      await markNotificationRead(id);
      if (latestNotification?.id === id) clearLatestNotification();
      setOpen(false);
      router.push(link || "/dashboard");
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="fixed right-3 top-3 z-50 sm:right-5 sm:top-5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        className="relative flex h-11 w-11 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-white shadow-lg hover:bg-neutral-800"
      >
        <IconBell className="h-5 w-5" />
        {unreadCount > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>
      {latestNotification && !open && (
        <button type="button" onClick={() => void openNotification(latestNotification.id, latestNotification.link)} className="absolute right-0 top-14 w-[min(24rem,calc(100vw-1.5rem))] rounded-xl border border-neutral-700 bg-neutral-950 p-4 text-left text-white shadow-2xl">
          <span className="block text-xs font-semibold uppercase tracking-wide text-cyan-300">New notification</span>
          <span className="mt-1 block text-sm font-semibold">{latestNotification.title}</span>
          {latestNotification.body && <span className="mt-1 block text-xs text-neutral-300">{latestNotification.body}</span>}
        </button>
      )}
      {open && (
        <section aria-label="Notifications" className="absolute right-0 mt-2 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 text-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
            <div>
              <h2 className="font-semibold">Notifications</h2>
              <p className="text-xs text-neutral-400">Messages, calls and account updates</p>
            </div>
            <button type="button" onClick={() => void markAllRead()} disabled={!unreadCount} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-cyan-300 hover:bg-neutral-800 disabled:opacity-40">
              <IconCheck className="h-4 w-4" />Mark all read
            </button>
          </header>
          <div className="max-h-[min(70vh,28rem)] overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-neutral-400">No notifications yet. New messages and meeting invites will appear here.</p>
            ) : notifications.slice(0, 50).map((notification) => (
              <button key={notification.id} type="button" onClick={() => void openNotification(notification.id, notification.link)} className={`block w-full border-b border-neutral-800 px-4 py-3 text-left transition hover:bg-neutral-900 ${notification.read ? "opacity-70" : "bg-cyan-950/25"}`}>
                <span className="flex items-start gap-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${notification.read ? "bg-neutral-600" : "bg-cyan-400"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{notification.title}</span>
                    {notification.body && <span className="mt-1 block break-words text-xs leading-relaxed text-neutral-300">{notification.body}</span>}
                    <time className="mt-1 block text-[11px] text-neutral-500">{new Date(notification.created_at).toLocaleString()}</time>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
function Avatar({ profile }: { profile: { first_name: string; last_name: string; avatar_url: string | null } }) {
  if (profile.avatar_url) {
    return (
      <img
        src={profile.avatar_url}
        className="h-7 w-7 shrink-0 rounded-full object-cover"
        width={50}
        height={50}
        alt="Avatar"
      />
    );
  }
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-600 text-xs font-bold text-white">
      {profile.first_name?.[0]}
      {profile.last_name?.[0]}
    </div>
  );
}

export const Logo = () => {
  return (
    <a
      href="/dashboard"
      className="relative z-20 flex items-center space-x-2 py-1 text-sm font-normal text-black"
    >
      <img src="/logo.svg" alt="Grid & Logic" className="h-6 w-6 shrink-0 rounded-full" />
      <motion.span
        animate={{ opacity: 1 }}
        className="font-medium whitespace-pre text-black dark:text-white"
      >
        Grid &amp; Logic
      </motion.span>
    </a>
  );
};

export const LogoIcon = () => {
  return (
    <a
      href="/dashboard"
      className="relative z-20 flex items-center space-x-2 py-1 text-sm font-normal text-black"
    >
      <img src="/logo.svg" alt="Grid & Logic" className="h-6 w-6 shrink-0 rounded-full" />
    </a>
  );
};