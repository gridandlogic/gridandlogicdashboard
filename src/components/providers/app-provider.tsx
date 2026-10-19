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
import { usePathname, useRouter } from "next/navigation";
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
  markAllRead: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  enablePushNotifications: () => Promise<void>;
  sendTestPushNotification: () => Promise<void>;
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
  const profileRef = useRef<Profile | null>(null);

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

      // Install the worker early, but ask for notification permission only
      // after the user chooses to enable call and message alerts.
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
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
            // The database push trigger sends OS notifications even when this
            // tab is closed. Sending from here would duplicate each alert.
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

  const enablePushNotifications = useCallback(async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      throw new Error("Push notifications are not supported in this browser.");
    }
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) throw new Error("Push notifications are not configured for this app yet.");

    const permission = await window.Notification.requestPermission();
    if (permission !== "granted") throw new Error("Allow notifications in your browser settings to receive calls and messages.");

    const registration = await navigator.serviceWorker.ready;
    let decodedVapidKey = vapidKey.replace(/-/g, "+").replace(/_/g, "/");
    decodedVapidKey += "=".repeat((4 - decodedVapidKey.length % 4) % 4);
    const applicationServerKey = Uint8Array.from(
      atob(decodedVapidKey),
      (character) => character.charCodeAt(0)
    );
    let subscription = await registration.pushManager.getSubscription();
    const currentApplicationServerKey = subscription?.options.applicationServerKey;
    const subscriptionKeyMatches = Boolean(
      currentApplicationServerKey &&
      currentApplicationServerKey.byteLength === applicationServerKey.byteLength &&
      new Uint8Array(currentApplicationServerKey).every(
        (byte, index) => byte === applicationServerKey[index]
      )
    );

    // Push subscriptions are bound to the VAPID public key used when created.
    // Renew stale subscriptions after the VAPID pair changes so future pushes
    // are sent with a key the browser recognizes.
    if (subscription && !subscriptionKeyMatches) {
      await subscription.unsubscribe();
      subscription = null;
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }
    const p256dh = subscription.getKey("p256dh");
    const auth = subscription.getKey("auth");
    if (!p256dh || !auth) throw new Error("Your browser returned an invalid push subscription.");

    const toBase64 = (value: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(value)));
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: profileRef.current?.id,
        subscription: {
          endpoint: subscription.endpoint,
          keys: { p256dh: toBase64(p256dh), auth: toBase64(auth) },
        },
      }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.error || "Could not save your notification settings. Please try again.");
    }
  }, []);

  const sendTestPushNotification = useCallback(async () => {
    const userId = profileRef.current?.id;
    if (!userId) throw new Error("Your profile is not ready. Refresh the dashboard and try again.");
    const response = await fetch("/api/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        title: "Grid & Logic test alert",
        body: "This is a direct test of push delivery to this account's registered devices.",
        url: "/dashboard/profile",
        kind: "push_test",
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || `Push test failed (${response.status}).`);
    if (!result?.sent) {
      if (result?.failed) throw new Error(`Push service rejected delivery to ${result.failed} device(s). Check the VAPID keys and server logs.`);
      throw new Error("No active push subscription is saved for this account. Enable alerts again on this device.");
    }
  }, []);

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
        markAllRead,
        refreshMembers,
        enablePushNotifications,
        sendTestPushNotification,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function PushNotificationsPrompt() {
  const { enablePushNotifications, sendTestPushNotification } = useApp();
  const pathname = usePathname();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [hasSubscription, setHasSubscription] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (window.Notification.permission !== "granted") {
      setHasSubscription(false);
      return;
    }
    navigator.serviceWorker.ready
      .then(async (registration) => {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) await enablePushNotifications();
        setHasSubscription(Boolean(subscription));
      })
      .catch((error) => {
        setHasSubscription(false);
        setMessage(error instanceof Error ? error.message : "Could not check this device's push subscription.");
      });
  }, [enablePushNotifications]);

  const inMeetingRoom = pathname.startsWith("/dashboard/meetings/") && pathname !== "/dashboard/meetings/";
  if (typeof window === "undefined" || !("Notification" in window) || window.Notification.permission === "denied" || dismissed || inMeetingRoom) {
    return null;
  }

  const enable = async () => {
    setBusy(true);
    setMessage("");
    try {
      await enablePushNotifications();
      setHasSubscription(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not enable notifications.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMessage("");
    try {
      await sendTestPushNotification();
      setMessage("Push sent. Check this device's notification tray.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send a test notification.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-3 left-3 z-40 flex max-w-[calc(100vw-1.5rem)] items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 shadow-xl sm:bottom-5 sm:left-auto sm:right-5">
      <div className="min-w-0 text-xs text-neutral-300">
        <p className="font-medium text-white">{hasSubscription ? "Push alerts enabled on this device" : "Get call and message alerts"}</p>
        {message && <p className="mt-1 max-w-64 text-amber-300">{message}</p>}
      </div>
      {hasSubscription ? (
        <button type="button" onClick={test} disabled={busy} className="shrink-0 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-60">
          {busy ? "Sending…" : "Send test"}
        </button>
      ) : (
        <button type="button" onClick={enable} disabled={busy} className="shrink-0 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-60">
          {busy ? "Enabling…" : "Enable"}
        </button>
      )}
      <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss notification prompt" className="shrink-0 rounded-md px-2 py-2 text-neutral-400 hover:bg-neutral-800 hover:text-white">×</button>
    </div>
  );
}
