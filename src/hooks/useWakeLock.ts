"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function useWakeLock() {
  const [isSupported, setIsSupported] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    setIsSupported("wakeLock" in navigator);
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!isSupported || isActive) return;

    try {
      const wakeLock = await navigator.wakeLock.request("screen");
      wakeLockRef.current = wakeLock;
      setIsActive(true);

      wakeLock.addEventListener("release", () => {
        setIsActive(false);
        wakeLockRef.current = null;
      });

      // Also listen for visibility changes to re-acquire
      const handleVisibilityChange = async () => {
        if (document.visibilityState === "visible" && wakeLockRef.current === null) {
          try {
            const newWakeLock = await navigator.wakeLock.request("screen");
            wakeLockRef.current = newWakeLock;
            setIsActive(true);
            newWakeLock.addEventListener("release", () => {
              setIsActive(false);
              wakeLockRef.current = null;
            });
          } catch {}
        }
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);
      return () => {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      };
    } catch (err) {
      console.warn("Wake Lock API failed:", err);
    }
  }, [isSupported, isActive]);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch {}
      wakeLockRef.current = null;
      setIsActive(false);
    }
  }, []);

  // Auto-release on unmount
  useEffect(() => {
    return () => {
      releaseWakeLock();
    };
  }, [releaseWakeLock]);

  return {
    isSupported,
    isActive,
    requestWakeLock,
    releaseWakeLock,
  };
}