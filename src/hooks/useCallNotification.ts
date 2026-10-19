"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useApp } from "@/components/providers/app-provider";

interface IncomingCall {
  id: string; meetingId: string; title: string; callerName: string; createdAt: Date;
}
export function useCallNotification() {
  const { supabase, notifications, markNotificationRead } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const [activeCall, setActiveCall] = useState<IncomingCall | null>(null);
  const seen = useRef(new Set<string>());
  const audio = useRef<AudioContext | null>(null);
  const oscillator = useRef<OscillatorNode | null>(null);
  const gain = useRef<GainNode | null>(null);

  const stopRingtone = useCallback(() => {
    try { oscillator.current?.stop(); } catch {}
    oscillator.current?.disconnect();
    gain.current?.disconnect();
    oscillator.current = null;
    gain.current = null;
    if ("vibrate" in navigator) navigator.vibrate(0);
  }, []);

  // Unlock the reusable audio context through a real user gesture.
  useEffect(() => {
    const unlock = () => {
      try {
        audio.current ??= new AudioContext();
        if (audio.current.state === "suspended") void audio.current.resume().catch(() => {});
      } catch {}
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      stopRingtone();
      if (audio.current) void audio.current.close().catch(() => {});
      audio.current = null;
    };
  }, [stopRingtone]);

  const playRingtone = useCallback(() => {
    stopRingtone();
    try {
      const context = audio.current;
      if (!context || context.state !== "running") return;
      const tone = context.createOscillator();
      const volume = context.createGain();
      oscillator.current = tone;
      gain.current = volume;
      tone.connect(volume);
      volume.connect(context.destination);
      tone.frequency.value = 800;
      volume.gain.value = 0;
      const now = context.currentTime;
      for (const offset of [0, 0.8]) {
        volume.gain.setValueAtTime(0.12, now + offset);
        volume.gain.setValueAtTime(0, now + offset + 0.4);
      }
      tone.start(now);
      tone.stop(now + 1.3);
    } catch {}
  }, [stopRingtone]);

  useEffect(() => {
    if (activeCall) return;
    const notification = notifications.find((item) =>
      item.type === "meeting_invite" && !item.read && !seen.current.has(item.id) &&
      Date.now() - Date.parse(item.created_at) < 45000 &&
      pathname !== item.link);
    if (!notification) return;
    const meetingId = notification.link?.split("/").pop();
    if (!meetingId) return;
    let cancelled = false;
    // Never ring an invite for a meeting that has already ended.
    void supabase.from("meetings").select("status,title").eq("id", meetingId).single().then(({ data, error }) => {
      if (cancelled || error) return;
      seen.current.add(notification.id);
      if (data?.status !== "live") return;
      setActiveCall({
        id: notification.id, meetingId,
        title: data.title,
        callerName: notification.body?.split(/ is calling you| invited you/)[0] || "A teammate",
        createdAt: new Date(notification.created_at),
      });
    });
    return () => { cancelled = true; };
  }, [notifications, supabase, activeCall, pathname]);

  useEffect(() => {
    if (!activeCall) return;
    const ring = () => {
      playRingtone();
      if ("vibrate" in navigator) navigator.vibrate([400, 300, 400]);
    };
    ring();
    const interval = setInterval(ring, 4000);
    const timeout = setTimeout(() => setActiveCall(null),
      Math.max(0, 45000 - (Date.now() - activeCall.createdAt.getTime())));
    const channel = supabase.channel("active-call-" + activeCall.id)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "meetings", filter: "id=eq." + activeCall.meetingId },
        ({ new: meeting }) => { if (meeting.status === "ended") setActiveCall(null); }).subscribe();
    return () => {
      clearInterval(interval); clearTimeout(timeout); stopRingtone();
      void supabase.removeChannel(channel);
    };
  }, [activeCall, playRingtone, stopRingtone, supabase]);

  const handleDismiss = useCallback(() => {
    if (activeCall) void markNotificationRead(activeCall.id).catch(console.error);
    stopRingtone();
    setActiveCall(null);
  }, [activeCall, markNotificationRead, stopRingtone]);
  const handleJoin = useCallback(() => {
    if (!activeCall) return;
    const destination = "/dashboard/meetings/" + activeCall.meetingId;
    handleDismiss();
    router.push(destination);
  }, [activeCall, handleDismiss, router]);
  return { activeCall, isVisible: Boolean(activeCall), handleJoin, handleDismiss };
}
