"use client";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Notification, Profile } from "@/lib/types";

type AppContextType = {
  supabase: SupabaseClient;
  profile: Profile;
  isAdmin: boolean;
  members: Profile[];
  notifications: Notification[];
  unreadCount: number;
  notifPermission: NotificationPermission | "unsupported";
  requestNotifPermission: () => Promise<void>;
  markAllRead: () => Promise<void>;
  refreshMembers: () => Promise<void>;
};

const AppContext = createContext<AppContextType | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window
      ? window.Notification.permission
      : "unsupported"
  );
  const profileRef = useRef<Profile | null>(null);

  const subscribeToPush = useCallback(async (userId: string) => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId, subscription: existingSub.toJSON() }),
        });
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidPublicKey,
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, subscription: sub.toJSON() }),
      });
    } catch {}
  }, []);

  const refreshMembers = useCallback(async () => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("first_name");
    if (data) setMembers(data as Profile[]);
  }, [supabase]);

  useEffect(() => {
    let notifChannel: ReturnType<typeof supabase.channel> | null = null;

    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data: prof } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (!prof || prof.status !== "approved") {
        router.replace("/pending");
        return;
      }
      setProfile(prof as Profile);
      profileRef.current = prof as Profile;

      await refreshMembers();

      const { data: notifs } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (notifs) setNotifications(notifs as Notification[]);

      if (typeof window !== "undefined" && "serviceWorker" in navigator) {
        try {
          await navigator.serviceWorker.register("/sw.js");
          if (window.Notification.permission === "granted") {
            await subscribeToPush(user.id);
          }
        } catch {}
      }

      notifChannel = supabase
        .channel("user-notifications")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const n = payload.new as Notification;
            setNotifications((prev) => [n, ...prev]);
            if (
              typeof window !== "undefined" &&
              "Notification" in window &&
              window.Notification.permission === "granted"
            ) {
              const notifOptions = {
                body: n.body ?? undefined,
                icon: "/logo.svg",
                badge: "/logo.svg",
                data: n.link ? { link: n.link } : undefined,
              };
              if ("serviceWorker" in navigator) {
                navigator.serviceWorker.ready.then((reg) =>
                  reg.showNotification(n.title, notifOptions)
                );
              } else {
                const browserNotif = new window.Notification(n.title, notifOptions);
                browserNotif.onclick = () => {
                  window.focus();
                  if (n.link) router.push(n.link);
                };
              }
            }

            if (typeof document !== "undefined" && document.hidden) {
              fetch("/api/push/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  user_id: user.id,
                  title: n.title,
                  body: n.body || "",
                  link: n.link || "/dashboard",
                }),
              }).catch(() => {});
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${user.id}`,
          },
          (payload) => {
            const updated = payload.new as Profile;
            setProfile(updated);
            if (updated.status !== "approved") router.replace("/pending");
          }
        )
        .subscribe();
    };

    init();

    return () => {
      if (notifChannel) supabase.removeChannel(notifChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestNotifPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const perm = await window.Notification.requestPermission();
    setNotifPermission(perm);
    if (perm === "granted" && profileRef.current) {
      await subscribeToPush(profileRef.current.id);
    }
  }, [subscribeToPush]);

  const markAllRead = useCallback(async () => {
    if (!profileRef.current) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", profileRef.current.id)
      .eq("read", false);
  }, [supabase]);

  if (!profile) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-950">
        <img src="/logo.svg" alt="Grid & Logic" className="h-14 w-14 animate-pulse rounded-full" />
      </div>
    );
  }

  return (
    <AppContext.Provider
      value={{
        supabase,
        profile,
        isAdmin: profile.role === "admin",
        members,
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
        notifPermission,
        requestNotifPermission,
        markAllRead,
        refreshMembers,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
