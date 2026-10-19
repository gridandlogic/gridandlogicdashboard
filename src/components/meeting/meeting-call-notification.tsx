"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCallNotification } from "@/hooks/useCallNotification";
import {
  IconVideo,
  IconPhone,
  IconX,
  IconUser,
  IconBell,
} from "@tabler/icons-react";

export function MeetingCallNotification() {
  const router = useRouter();
  const { activeCall, isVisible, handleJoin, handleDismiss } = useCallNotification();

  useCallKeyboardShortcuts(isVisible, handleJoin, handleDismiss);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!activeCall) return;
    const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - activeCall.createdAt.getTime()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [activeCall]);
  useEffect(() => {
    if (!isVisible) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [isVisible]);

  if (!activeCall) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm transition-all duration-300 ${
        isVisible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Incoming meeting call"
    >
      {/* Background pulse animation */}
      <div
        className="absolute inset-0 bg-gradient-to-br from-cyan-500/20 via-transparent to-blue-600/20 animate-pulse"
        aria-hidden="true"
      />

      <div
        className={`relative w-full max-w-sm mx-4 transform rounded-3xl bg-gradient-to-b from-neutral-900 to-neutral-950 p-8 text-center shadow-2xl border border-neutral-800 transition-all duration-300 ${
          isVisible ? "scale-100 translate-y-0" : "scale-95 translate-y-4"
        }`}
      >
        {/* Close button - only show on desktop or as secondary action */}
        <button
          onClick={handleDismiss}
          className="absolute right-4 top-4 rounded-full p-2 text-neutral-400 transition hover:bg-neutral-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
          aria-label="Dismiss call"
        >
          <IconX className="h-5 w-5" />
        </button>

        {/* Animated caller avatar with pulsing rings */}
        <div className="relative mx-auto mb-6" aria-hidden="true">
          <div className="absolute inset-0 animate-ping rounded-full bg-cyan-500/30" />
          <div className="absolute inset-2 animate-pulse rounded-full bg-cyan-500/20" />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-3xl font-bold text-white shadow-lg shadow-cyan-500/30">
            {activeCall.callerName
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>
        </div>

        {/* Caller info */}
        <h2 className="text-xl font-semibold text-white">
          {activeCall.callerName}
        </h2>
        <p className="mt-1 text-sm text-neutral-400">is inviting you to a meeting</p>

        {/* Meeting title */}
        <div className="mt-4 rounded-xl bg-neutral-800/50 px-4 py-3 border border-neutral-700">
          <div className="flex items-center justify-center gap-2 text-cyan-400">
            <IconVideo className="h-4 w-4" />
            <span className="text-sm font-medium truncate max-w-[200px]">
              {activeCall.title}
            </span>
          </div>
        </div>

        {/* Time since call started */}
        <p className="mt-3 text-xs text-neutral-500">
          Ringing for{" "}
          <span id="call-duration" className="font-mono">
            {seconds}s
          </span>
        </p>

        {/* Action buttons - Google Meet style */}
        <div className="mt-8 flex items-center justify-center gap-6">
          <button
            onClick={handleDismiss}
            className="group relative flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20 text-red-400 transition hover:bg-red-500/30 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-500"
            title="Decline"
            aria-label="Decline call"
          >
            <IconX className="h-7 w-7" />
            <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-xs text-neutral-500 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
              Decline
            </span>
          </button>

          <button
            onClick={handleJoin}
            className="group relative flex h-18 w-18 items-center justify-center rounded-full bg-green-500 text-white shadow-lg shadow-green-500/40 transition hover:bg-green-400 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-500"
            title="Join meeting"
            aria-label="Join meeting"
          >
            <IconVideo className="h-8 w-8" />
            <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-xs text-neutral-500 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
              Join
            </span>
          </button>
        </div>

        {/* Swipe hint for mobile */}
        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-neutral-500">
          <IconBell className="h-3.5 w-3.5 animate-bounce text-cyan-400" />
          <span>Tap the green button to join or the red button to decline</span>
        </div>

        {/* Keyboard hint */}
        <p className="mt-2 text-xs text-neutral-600 hidden sm:block">
          Press <kbd className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 font-mono">Enter</kbd> to join, <kbd className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 font-mono">Esc</kbd> to decline
        </p>
      </div>
    </div>
  );
}

// Keyboard handling for call notification
export function useCallKeyboardShortcuts(
  isVisible: boolean,
  onJoin: () => void,
  onDismiss: () => void
) {
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onJoin();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, onJoin, onDismiss]);
}