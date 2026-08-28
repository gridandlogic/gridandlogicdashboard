"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/providers/app-provider";
import type { Notification } from "@/lib/types";
import {
  IconVideo,
  IconPhone,
  IconX,
  IconUser,
} from "@tabler/icons-react";

interface MeetingCall {
  id: string;
  meetingId: string;
  title: string;
  callerName: string;
  createdAt: Date;
}

export function MeetingCallNotification() {
  const { supabase, profile } = useApp();
  const router = useRouter();
  const [activeCall, setActiveCall] = useState<MeetingCall | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const handleMeetingInvite = useCallback((notification: Notification) => {
    if (notification.type !== "meeting_invite") return;

    const call: MeetingCall = {
      id: notification.id,
      meetingId: notification.link?.split("/").pop() || "",
      title: notification.body?.match(/"([^"]+)"/)?.[1] || "Meeting",
      callerName: notification.body?.split(" invited you")[0] || "Someone",
      createdAt: new Date(notification.created_at),
    };

    setActiveCall(call);
    setIsVisible(true);

    // Play ringtone sound
    playRingtone();

    // Auto-dismiss after 30 seconds
    setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => setActiveCall(null), 300);
    }, 30000);
  }, []);

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
    };
  }, [supabase, profile.id, handleMeetingInvite]);

  const handleJoin = () => {
    if (activeCall) {
      router.push(`/dashboard/meetings/${activeCall.meetingId}`);
    }
    setIsVisible(false);
    setTimeout(() => setActiveCall(null), 300);
  };

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(() => setActiveCall(null), 300);
  };

  if (!activeCall) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm transition-all duration-300 ${
        isVisible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      <div
        className={`relative w-full max-w-sm transform rounded-3xl bg-gradient-to-b from-neutral-800 to-neutral-900 p-8 text-center shadow-2xl transition-all duration-300 ${
          isVisible ? "scale-100 translate-y-0" : "scale-95 translate-y-4"
        }`}
      >
        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute right-4 top-4 rounded-full p-2 text-neutral-400 transition hover:bg-neutral-700 hover:text-white"
        >
          <IconX className="h-5 w-5" />
        </button>

        {/* Animated caller avatar */}
        <div className="relative mx-auto mb-6">
          <div className="absolute inset-0 animate-ping rounded-full bg-cyan-500/30" />
          <div className="absolute inset-2 animate-pulse rounded-full bg-cyan-500/20" />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-3xl font-bold text-white shadow-lg">
            {activeCall.callerName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
          </div>
        </div>

        {/* Caller info */}
        <h2 className="text-xl font-semibold text-white">
          {activeCall.callerName}
        </h2>
        <p className="mt-1 text-sm text-neutral-400">is inviting you to a meeting</p>

        {/* Meeting title */}
        <div className="mt-4 rounded-xl bg-neutral-700/50 px-4 py-3">
          <div className="flex items-center justify-center gap-2 text-cyan-400">
            <IconVideo className="h-4 w-4" />
            <span className="text-sm font-medium">{activeCall.title}</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-8 flex items-center justify-center gap-4">
          <button
            onClick={handleDismiss}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/20 text-red-400 transition hover:bg-red-500/30"
            title="Decline"
          >
            <IconX className="h-6 w-6" />
          </button>
          <button
            onClick={handleJoin}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500 text-white shadow-lg shadow-green-500/30 transition hover:bg-green-400"
            title="Join meeting"
          >
            <IconVideo className="h-7 w-7" />
          </button>
        </div>

        <p className="mt-4 text-xs text-neutral-500">Tap to join or dismiss</p>
      </div>
    </div>
  );
}

function playRingtone() {
  // Create a simple ringtone using Web Audio API
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = "sine";
    gainNode.gain.value = 0.1;

    // Ring pattern
    const now = audioContext.currentTime;
    gainNode.gain.setValueAtTime(0.1, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    gainNode.gain.setValueAtTime(0.1, now + 1);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 1.5);

    oscillator.start(now);
    oscillator.stop(now + 2);
  } catch {
    // Audio not supported
  }
}
