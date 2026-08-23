"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconClock, IconLogout } from "@tabler/icons-react";

export default function PendingPage() {
  const router = useRouter();
  const supabase = createClient();
  const [status, setStatus] = useState<string>("pending");

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

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
          else if (data) setStatus(data.status);
        });

      channel = supabase
        .channel("profile-status")
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${user.id}`,
          },
          (payload) => {
            const newStatus = (payload.new as { status: string }).status;
            setStatus(newStatus);
            if (newStatus === "approved") router.replace("/dashboard");
          }
        )
        .subscribe();
    });

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-black p-8 text-center">
        <img src="/logo.svg" alt="Grid & Logic" className="mx-auto h-14 w-14" />
        {status === "removed" ? (
          <>
            <h1 className="mt-6 text-xl font-bold text-red-400">Access removed</h1>
            <p className="mt-2 text-sm text-neutral-400">
              An admin has removed your access to Grid &amp; Logic. Contact your
              administrator if you think this is a mistake.
            </p>
          </>
        ) : (
          <>
            <div className="mt-6 flex items-center justify-center gap-2 text-amber-400">
              <IconClock className="h-5 w-5 animate-pulse" />
              <h1 className="text-xl font-bold">Waiting for approval</h1>
            </div>
            <p className="mt-2 text-sm text-neutral-400">
              Your account has been created and the admins have been notified.
              You&apos;ll be redirected automatically as soon as an admin approves
              your access.
            </p>
          </>
        )}
        <button
          onClick={logout}
          className="mt-8 inline-flex items-center gap-2 rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-900"
        >
          <IconLogout className="h-4 w-4" /> Sign out
        </button>
      </div>
    </div>
  );
}
