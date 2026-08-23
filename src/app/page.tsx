"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      supabase
        .from("profiles")
        .select("status")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          if (data?.status === "approved") router.replace("/dashboard");
          else router.replace("/pending");
        });
    });
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center bg-neutral-950">
      <div className="flex flex-col items-center gap-4">
        <img src="/logo.svg" alt="Grid & Logic" className="h-16 w-16 animate-pulse" />
        <p className="text-sm text-neutral-400">Loading Grid &amp; Logic…</p>
      </div>
    </div>
  );
}
