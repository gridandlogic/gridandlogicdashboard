"use client";
import React from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  IconChartBar,
  IconUsers,
  IconChecklist,
} from "@tabler/icons-react";

export default function SignupPage() {
  const supabase = createClient();

  const handleGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#0a0a0a] px-6 py-8 md:px-20 md:py-10">
      {/* Brand Header */}
      <header className="mb-8 md:mb-12">
        <div className="flex items-center gap-1.5">
          <img src="/logo.svg" alt="Grid & Logic" className="h-8 w-8 rounded-full" />
          <span className="text-2xl font-extrabold tracking-tight text-white">
            Grid &amp; Logic
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-center gap-12 md:grid-cols-2 md:gap-20">
        {/* Left Column — Features */}
        <section>
          <h1 className="mb-4 font-serif text-3xl font-normal text-white md:text-4xl">
            Executive Operations Hub
          </h1>
          <p className="mb-10 max-w-md text-[15px] leading-relaxed text-neutral-400">
            Empowering retail excellence through data-driven insights and seamless
            operations management.
          </p>

          <div className="flex flex-col gap-5">
            <FeatureItem
              icon={<IconChartBar className="h-[22px] w-[22px]" />}
              title="Real-time Analytics"
              desc="Monitor performance metrics instantly"
            />
            <FeatureItem
              icon={<IconUsers className="h-[22px] w-[22px]" />}
              title="Team Management"
              desc="Coordinate your retail team efficiently"
            />
            <FeatureItem
              icon={<IconChecklist className="h-[22px] w-[22px]" />}
              title="Audit Tracking"
              desc="Track compliance and quality standards"
            />
          </div>
        </section>

        {/* Right Column — Sign Up */}
        <section className="flex flex-col items-start md:pl-10">
          <h2 className="mb-3 font-serif text-3xl font-normal text-white">
            Get Started
          </h2>
          <p className="mb-8 text-sm text-neutral-400">
            Sign up with your Google account. An admin will review and approve your access.
          </p>

          <button
            onClick={handleGoogle}
            className="group flex w-full max-w-sm items-center justify-center gap-3 rounded-md border border-neutral-700 bg-neutral-900 px-5 py-3 shadow-sm transition hover:bg-neutral-800 hover:shadow-md"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span className="text-[15px] font-semibold text-neutral-200">
              Sign up with Google
            </span>
          </button>

          <div className="mt-10 w-full max-w-sm">
            <p className="text-center text-xs text-neutral-500">
              Protected by enterprise-grade security
            </p>
            <p className="mt-1.5 text-center text-xs text-neutral-400">
              Already have an account?{" "}
              <Link href="/login" className="font-bold text-[#0088cc] hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </section>
      </main>

      {/* Bottom Section */}
      <footer className="mt-12">
        <div className="h-0.5 w-full max-w-md bg-[#4ebbeb]" />
        <p className="mt-4 text-xs uppercase tracking-widest text-neutral-500">
          Operational Platform
        </p>
      </footer>
    </div>
  );
}

function FeatureItem({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-cyan-500/10 text-cyan-400">
        {icon}
      </div>
      <div>
        <h3 className="text-[15px] font-bold text-white">{title}</h3>
        <p className="text-[13px] text-neutral-400">{desc}</p>
      </div>
    </div>
  );
}
