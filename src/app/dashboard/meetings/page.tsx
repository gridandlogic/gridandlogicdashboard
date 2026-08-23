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
          <IconVideo className="h-6 w-6 text-red-400" />
          <h1 className="text-2xl font-bold text-neutral-800 dark:text-white">
            Meetings
          </h1>
        </div>
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Meeting title (optional)"
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-cyan-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
          />
          <button
            onClick={createMeeting}
            disabled={creating}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
          >
            <IconVideoPlus className="h-4 w-4" /> Start Meeting
          </button>
        </div>
      </div>

      {/* Live meetings */}
      <div>
        <h2 className="mb-3 flex items-center gap-2 font-semibold text-neutral-700 dark:text-neutral-200">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" /> Live now
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {live.map((m) => {
            const parts = participantsOf(m.id);
            const invited = parts.some((p) => p.user_id === profile.id);
            const canJoin = m.created_by === profile.id || invited;
            return (
              <div
                key={m.id}
                className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5 transition hover:border-red-500/50"
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                  <span className="text-[10px] font-bold uppercase tracking-wide text-red-400">Live</span>
                </div>
                <h3 className="mt-2 font-semibold text-neutral-800 dark:text-white">
                  {m.title}
                </h3>
                <p className="mt-1 text-xs text-neutral-500">
                  Started by {memberName(m.created_by)} · {formatTime(m.started_at)}
                </p>
                <div className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500">
                  <IconUsers className="h-3.5 w-3.5" />
                  {parts.length > 0
                    ? `${parts.length} participant${parts.length > 1 ? "s" : ""}`
                    : "No participants yet"}
                </div>
                {canJoin ? (
                  <button
                    onClick={() => router.push(`/dashboard/meetings/${m.id}`)}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white transition hover:bg-red-500"
                  >
                    <IconVideo className="h-4 w-4" /> Join Meeting
                  </button>
                ) : (
                  <p className="mt-4 rounded-lg bg-neutral-200 py-2.5 text-center text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                    In progress — not invited
                  </p>
                )}
              </div>
            );
          })}
          {live.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-300 py-12 text-neutral-400 dark:border-neutral-700">
              <IconVideo className="h-8 w-8" />
              <p className="text-sm">No live meetings right now.</p>
            </div>
          )}
        </div>
      </div>

      {/* Past meetings */}
      <div>
        <h2 className="mb-3 flex items-center gap-2 font-semibold text-neutral-700 dark:text-neutral-200">
          <IconHistory className="h-4 w-4" /> Meeting records
        </h2>
        <div className="flex flex-col gap-2">
          {ended.map((m) => {
            const parts = participantsOf(m.id);
            return (
              <div
                key={m.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-gray-50 p-4 transition hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-neutral-600"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-200 dark:bg-neutral-700">
                  <IconHistory className="h-5 w-5 text-neutral-500" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-neutral-800 dark:text-white">
                    {m.title}
                  </p>
                  <p className="text-xs text-neutral-500">
                    Held by {memberName(m.created_by)} · {formatDate(m.started_at)}{" "}
                    {formatTime(m.started_at)}
                    {m.ended_at && ` — ${formatTime(m.ended_at)}`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                  <IconUsers className="h-3.5 w-3.5" />
                  {parts.length > 0
                    ? `${parts.length} participant${parts.length > 1 ? "s" : ""}`
                    : "—"}
                </div>
              </div>
            );
          })}
          {ended.length === 0 && (
            <p className="text-sm text-neutral-500">No past meetings yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
