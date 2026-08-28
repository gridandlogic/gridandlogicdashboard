"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/providers/app-provider";
import type { Meeting, MeetingParticipant } from "@/lib/types";
import { formatDate, formatTime } from "@/lib/utils";
import {
  IconVideo,
  IconVideoPlus,
  IconHistory,
  IconUsers,
  IconPlayerPlay,
} from "@tabler/icons-react";

export default function MeetingsPage() {
  const { supabase, profile, members } = useApp();
  const router = useRouter();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("meetings")
      .select("*")
      .order("started_at", { ascending: false });
    if (data) setMeetings(data as Meeting[]);
    const { data: parts } = await supabase.from("meeting_participants").select("*");
    if (parts) setParticipants(parts as MeetingParticipant[]);
  }, [supabase]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("meetings-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "meetings" },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, load]);

  const createMeeting = async () => {
    if (creating) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("meetings")
      .insert({
        title: title.trim() || `${profile.first_name}'s meeting`,
        created_by: profile.id,
        status: "live",
      })
      .select()
      .single();
    setCreating(false);
    if (error) {
      alert(error.message);
      return;
    }
    router.push(`/dashboard/meetings/${data.id}`);
  };

  const memberName = (id: string) => {
    const m = members.find((x) => x.id === id);
    return m ? `${m.first_name} ${m.last_name}` : "Unknown";
  };

  const participantsOf = (meetingId: string) =>
    participants.filter((p) => p.meeting_id === meetingId);

  const live = meetings.filter((m) => m.status === "live");
  const ended = meetings.filter((m) => m.status === "ended");

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 md:p-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <IconVideo className="h-6 w-6 text-cyan-400" />
          <h1 className="text-2xl font-bold text-neutral-800 dark:text-white">
            Meetings
          </h1>
        </div>
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Meeting title (optional)"
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm text-neutral-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
          />
          <button
            onClick={createMeeting}
            disabled={creating}
            className="flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50"
          >
            <IconVideoPlus className="h-4 w-4" /> Start Meeting
          </button>
        </div>
      </div>

      {/* Live meetings */}
      <div>
        <h2 className="mb-4 flex items-center gap-2 font-semibold text-neutral-700 dark:text-neutral-200">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
          </span>
          Live now
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {live.map((m) => {
            const parts = participantsOf(m.id);
            const invited = parts.some((p) => p.user_id === profile.id);
            const canJoin = m.created_by === profile.id || invited;
            return (
              <div
                key={m.id}
                className="group rounded-2xl border border-green-500/30 bg-gradient-to-br from-green-500/5 to-cyan-500/5 p-5 transition hover:border-green-500/50 hover:shadow-lg"
              >
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-green-400">Live</span>
                </div>
                <h3 className="mt-3 text-lg font-semibold text-neutral-800 dark:text-white">
                  {m.title}
                </h3>
                <p className="mt-1 text-sm text-neutral-500">
                  Started by {memberName(m.created_by)} · {formatTime(m.started_at)}
                </p>
                <div className="mt-3 flex items-center gap-1.5 text-sm text-neutral-500">
                  <IconUsers className="h-4 w-4" />
                  {parts.length > 0
                    ? `${parts.length} participant${parts.length > 1 ? "s" : ""}`
                    : "No participants yet"}
                </div>
                {canJoin ? (
                  <button
                    onClick={() => router.push(`/dashboard/meetings/${m.id}`)}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3 text-sm font-semibold text-white transition hover:bg-green-500"
                  >
                    <IconPlayerPlay className="h-4 w-4" /> Join Meeting
                  </button>
                ) : (
                  <p className="mt-5 rounded-xl bg-neutral-200 py-3 text-center text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                    In progress — not invited
                  </p>
                )}
              </div>
            );
          })}
          {live.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-300 py-16 text-neutral-400 dark:border-neutral-700">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-200 dark:bg-neutral-800">
                <IconVideo className="h-8 w-8" />
              </div>
              <p className="text-sm font-medium">No live meetings right now</p>
              <p className="text-xs text-neutral-500">Start a meeting to begin collaborating</p>
            </div>
          )}
        </div>
      </div>

      {/* Past meetings */}
      <div>
        <h2 className="mb-4 flex items-center gap-2 font-semibold text-neutral-700 dark:text-neutral-200">
          <IconHistory className="h-4 w-4" /> Meeting history
        </h2>
        <div className="flex flex-col gap-2">
          {ended.map((m) => {
            const parts = participantsOf(m.id);
            return (
              <div
                key={m.id}
                className="flex flex-wrap items-center gap-4 rounded-xl border border-neutral-200 bg-gray-50 p-4 transition hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-neutral-600"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-neutral-200 dark:bg-neutral-700">
                  <IconHistory className="h-5 w-5 text-neutral-500" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-neutral-800 dark:text-white">
                    {m.title}
                  </p>
                  <p className="text-xs text-neutral-500">
                    Hosted by {memberName(m.created_by)} · {formatDate(m.started_at)}{" "}
                    {formatTime(m.started_at)}
                    {m.ended_at && ` — ${formatTime(m.ended_at)}`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-neutral-500">
                  <IconUsers className="h-4 w-4" />
                  {parts.length > 0
                    ? `${parts.length} participant${parts.length > 1 ? "s" : ""}`
                    : "—"}
                </div>
              </div>
            );
          })}
          {ended.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-300 py-10 text-neutral-400 dark:border-neutral-700">
              <IconHistory className="h-6 w-6" />
              <p className="text-sm">No past meetings yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
