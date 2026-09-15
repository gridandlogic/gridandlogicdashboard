"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/providers/app-provider";
import type { Notification } from "@/lib/types";

interface IncomingCall {
  id: string;
  meetingId: string;
  title: string;
  callerName: string;
  createdAt: Date;
}

export function useCallNotification() {
  const { supabase, profile } = useApp();
  const router = useRouter();
  const [activeCall, setActiveCall] = useState<IncomingCall | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const playRingtone = useCallback(() => {
    try {
      // Stop any existing ringtone
      stopRingtone();

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillatorRef.current = oscillator;
      gainNodeRef.current = gainNode;

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Google Meet style ringtone: two-tone pattern
      oscillator.frequency.value = 800;
      oscillator.type = "sine";
      gainNode.gain.value = 0.15;

      // Ring pattern: 0.4s on, 0.4s off, 0.4s on, 2s off - repeat
      const now = audioContext.currentTime;
      const pattern = [
        { start: now, end: now + 0.4 },
        { start: now + 0.8, end: now + 1.2 },
        { start: now + 2.0, end: now + 2.4 },
        { start: now + 2.8, end: now + 3.2 },
      ];

      pattern.forEach((p) => {
        gainNode.gain.setValueAtTime(0.15, p.start);
        gainNode.gain.exponentialRampToValueAtTime(0.001, p.end);
      });

      oscillator.start(now);
      // Stop after ~10 seconds, will be restarted by interval
      oscillator.stop(now + 10);
    } catch {
      // Audio not supported
    }
  }, []);

  const stopRingtone = useCallback(() => {
    try {
      if (oscillatorRef.current) {
        oscillatorRef.current.stop();
        oscillatorRef.current.disconnect();
        oscillatorRef.current = null;
      }
      if (gainNodeRef.current) {
        gainNodeRef.current.disconnect();
        gainNodeRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    } catch {}
  }, []);

  const vibrate = useCallback(() => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      // Vibration pattern: 500ms on, 500ms off, repeat
      navigator.vibrate([500, 500, 500, 500, 500, 500]);
    }
  }, []);

  const handleMeetingInvite = useCallback(
    (notification: Notification) => {
      if (notification.type !== "meeting_invite") return;

      const call: IncomingCall = {
        id: notification.id,
        meetingId: notification.link?.split("/").pop() || "",
        title:
          notification.body?.match(/"([^"]+)"/)?.[1] || "Meeting",
        callerName:
          notification.body?.split(" invited you")[0] ||
          notification.body?.split(" is calling you")[0] ||
          "Someone",
        createdAt: new Date(notification.created_at),
      };

      setActiveCall(call);
      setIsVisible(true);

      // Play ringtone immediately
      playRingtone();

      // Vibrate on mobile
      vibrate();

      // Continue ringtone/vibration until answered or dismissed
      const ringInterval = setInterval(() => {
        if (!isVisible) {
          clearInterval(ringInterval);
          return;
        }
        playRingtone();
        vibrate();
      }, 4000); // Pattern repeats every 4 seconds

      // Auto-dismiss after 45 seconds (longer for mobile)
      const dismissTimeout = setTimeout(() => {
        clearInterval(ringInterval);
        setIsVisible(false);
        stopRingtone();
        setTimeout(() => setActiveCall(null), 300);
      }, 45000);

      // Store cleanup functions
      (window as any).__callCleanup = {
        ringInterval,
        dismissTimeout,
      };
    },
    [playRingtone, stopRingtone, vibrate, isVisible]
  );

  useEffect(() => {
    // Listen for new meeting notifications
    const channel = supabase
      .channel(`meeting-calls-${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          const notification = payload.new as Notification;
          if (notification.type === "meeting_invite") {
            handleMeetingInvite(notification);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      // Cleanup on unmount
      if ((window as any).__callCleanup) {
        clearInterval((window as any).__callCleanup.ringInterval);
        clearTimeout((window as any).__callCleanup.dismissTimeout);
        delete (window as any).__callCleanup;
      }
      stopRingtone();
    };
  }, [supabase, profile.id, handleMeetingInvite, stopRingtone]);

  const handleJoin = useCallback(() => {
    if (activeCall) {
      // Cleanup before navigation
      if ((window as any).__callCleanup) {
        clearInterval((window as any).__callCleanup.ringInterval);
        clearTimeout((window as any).__callCleanup.dismissTimeout);
        delete (window as any).__callCleanup;
      }
      stopRingtone();
      router.push(`/dashboard/meetings/${activeCall.meetingId}`);
    }
    setIsVisible(false);
    setTimeout(() => setActiveCall(null), 300);
  }, [activeCall, router, stopRingtone]);

  const handleDismiss = useCallback(() => {
    if ((window as any).__callCleanup) {
      clearInterval((window as any).__callCleanup.ringInterval);
      clearTimeout((window as any).__callCleanup.dismissTimeout);
      delete (window as any).__callCleanup;
    }
    stopRingtone();
    setIsVisible(false);
    setTimeout(() => setActiveCall(null), 300);
  }, [stopRingtone]);

  // Cleanup on page visibility change (tab backgrounded)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isVisible) {
        // Restart ringtone when tab becomes visible again
        playRingtone();
        vibrate();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isVisible, playRingtone, vibrate]);

  return {
    activeCall,
    isVisible,
    handleJoin,
    handleDismiss,
  };
}