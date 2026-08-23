"use client";
import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { IconBrandGoogle } from "@tabler/icons-react";

export default function LoginPage() {
  const supabase = createClient();

  const handleGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 py-10">
      <div className="shadow-input mx-auto w-full max-w-md rounded-2xl bg-white p-4 md:p-8 dark:bg-black">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="Grid & Logic" className="h-10 w-10" />
          <h2 className="text-xl font-bold text-neutral-800 dark:text-neutral-200">
            Welcome back to Grid &amp; Logic
          </h2>
        </div>
        <p className="mt-2 max-w-sm text-sm text-neutral-600 dark:text-neutral-300">
          Sign in with your Google account to access your boards, channels, messages and meetings.
        </p>

        <div className="my-8 flex flex-col space-y-6">
          <button
            className="group/btn shadow-input relative flex h-12 w-full items-center justify-center space-x-3 rounded-md bg-gray-50 px-4 font-medium text-black dark:bg-zinc-900 dark:shadow-[0px_0px_1px_1px_#262626]"
            type="button"
            onClick={handleGoogle}
          >
            <IconBrandGoogle className="h-5 w-5 text-neutral-800 dark:text-neutral-300" />
            <span className="text-sm text-neutral-700 dark:text-neutral-300">
              Continue with Google
            </span>
            <BottomGradient />
          </button>

          <p className="mt-6 text-center text-sm text-neutral-600 dark:text-neutral-400">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="font-medium text-cyan-500 hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

const BottomGradient = () => {
  return (
    <>
      <span className="absolute inset-x-0 -bottom-px block h-px w-full bg-gradient-to-r from-transparent via-cyan-500 to-transparent opacity-0 transition duration-500 group-hover/btn:opacity-100" />
      <span className="absolute inset-x-10 -bottom-px mx-auto block h-px w-1/2 bg-gradient-to-r from-transparent via-indigo-500 to-transparent opacity-0 blur-sm transition duration-500 group-hover/btn:opacity-100" />
    </>
  );
};

const LabelInputContainer = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("flex w-full flex-col space-y-2", className)}>
      {children}
    </div>
  );
};
