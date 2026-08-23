"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/providers/app-provider";
import {
  IconLayoutKanban,
  IconHash,
  IconMessageCircle,
  IconVideo,
  IconUsers,
} from "@tabler/icons-react";

export default function DashboardHome() {
  const { supabase, profile, members } = useApp();
  const [stats, setStats] = useState({
    boards: 0,
    channels: 0,
    liveMeetings: 0,
    myTasks: 0,
  });

  useEffect(() => {
    const load = async () => {
      const [boards, channels, meetings, tasks] = await Promise.all([
        supabase.from("boards").select("id", { count: "exact", head: true }),
        supabase.from("channels").select("id", { count: "exact", head: true }),
        supabase
          .from("meetings")
          .select("id", { count: "exact", head: true })
          .eq("status", "live"),
        supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("assignee_id", profile.id)
          .neq("status", "done"),
      ]);
      setStats({
        boards: boards.count ?? 0,
        channels: channels.count ?? 0,
        liveMeetings: meetings.count ?? 0,
        myTasks: tasks.count ?? 0,
      });
    };
    load();
  }, [supabase, profile.id]);

  const cards = [
    {
      label: "Sprint Boards",
      value: stats.boards,
      href: "/dashboard/boards",
      icon: <IconLayoutKanban className="h-6 w-6 text-cyan-400" />,
    },
    {
      label: "Channels",
      value: stats.channels,
      href: "/dashboard/channels",
      icon: <IconHash className="h-6 w-6 text-emerald-400" />,
    },
    {
      label: "Live Meetings",
      value: stats.liveMeetings,
      href: "/dashboard/meetings",
      icon: <IconVideo className="h-6 w-6 text-red-400" />,
    },
    {
      label: "My Open Tasks",
      value: stats.myTasks,
      href: "/dashboard/boards",
      icon: <IconMessageCircle className="h-6 w-6 text-amber-400" />,
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 md:p-10">
      <div>
        <h1 className="text-2xl font-bold text-neutral-800 dark:text-white">
          Welcome back, {profile.first_name} 👋
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Here&apos;s what&apos;s happening at Grid &amp; Logic today.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-xl border border-neutral-200 bg-gray-50 p-5 transition hover:scale-[1.02] hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-neutral-600"
          >
            <div className="flex items-center justify-between">
              {card.icon}
              <span className="text-3xl font-bold text-neutral-800 dark:text-white">
                {card.value}
              </span>
            </div>
            <p className="mt-3 text-sm font-medium text-neutral-600 dark:text-neutral-300">
              {card.label}
            </p>
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-neutral-200 bg-gray-50 p-5 dark:border-neutral-700 dark:bg-neutral-800">
        <div className="flex items-center gap-2">
          <IconUsers className="h-5 w-5 text-neutral-500 dark:text-neutral-400" />
          <h2 className="font-semibold text-neutral-800 dark:text-white">Team</h2>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {members
            .filter((m) => m.status === "approved")
            .map((m) => (
              <Link
                key={m.id}
                href={`/dashboard/dm?user=${m.id}`}
                className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:border-cyan-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-600 text-[10px] font-bold text-white">
                  {m.first_name?.[0]}
                  {m.last_name?.[0]}
                </span>
                {m.first_name} {m.last_name}
                {m.role === "admin" && (
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500">
                    ADMIN
                  </span>
                )}
                {m.tags && m.tags.length > 0 && (
                  <span className="flex flex-wrap gap-0.5">
                    {m.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-cyan-500/15 px-1 py-0.5 text-[9px] font-medium text-cyan-600 dark:text-cyan-400"
                      >
                        {tag}
                      </span>
                    ))}
                    {m.tags.length > 3 && (
                      <span className="text-[9px] text-neutral-400">
                        +{m.tags.length - 3}
                      </span>
                    )}
                  </span>
                )}
              </Link>
            ))}
        </div>
      </div>
    </div>
  );
}
