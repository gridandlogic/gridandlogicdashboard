"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/providers/app-provider";
import type { Profile } from "@/lib/types";
import { AVAILABLE_TAGS, MAX_TAGS } from "@/lib/tags";
import {
  IconShieldCog,
  IconUserCheck,
  IconUserX,
  IconUserUp,
  IconUserDown,
  IconTag,
} from "@tabler/icons-react";

export default function AdminPage() {
  const { supabase, profile, isAdmin, members, refreshMembers } = useApp();
  const router = useRouter();

  useEffect(() => {
    if (!isAdmin) router.replace("/dashboard");
  }, [isAdmin, router]);

  useEffect(() => {
    const ch = supabase
      .channel("admin-profiles")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => refreshMembers()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, refreshMembers]);

  if (!isAdmin) return null;

  const setStatus = async (user: Profile, status: Profile["status"]) => {
    const { error } = await supabase
      .from("profiles")
      .update({ status })
      .eq("id", user.id);
    if (error) {
      alert(error.message);
      return;
    }
    if (status === "approved") {
      await supabase.from("notifications").insert({
        user_id: user.id,
        type: "access_granted",
        title: "✅ Access granted",
        body: `Welcome to Grid & Logic, ${user.first_name}! An admin approved your account.`,
        link: "/dashboard",
      });
    }
    refreshMembers();
  };

  const setRole = async (user: Profile, role: Profile["role"]) => {
    if (
      role === "member" &&
      user.id === profile.id &&
      members.filter((m) => m.role === "admin").length <= 1
    ) {
      alert("You are the only admin — promote someone else first.");
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", user.id);
    if (error) alert(error.message);
    else refreshMembers();
  };

  const toggleTag = async (user: Profile, tag: string) => {
    const current = user.tags || [];
    let newTags: string[];
    if (current.includes(tag)) {
      newTags = current.filter((t) => t !== tag);
    } else {
      if (current.length >= MAX_TAGS) {
        alert(`Maximum ${MAX_TAGS} tags allowed per member.`);
        return;
      }
      newTags = [...current, tag];
    }
    const { error } = await supabase
      .from("profiles")
      .update({ tags: newTags })
      .eq("id", user.id);
    if (error) alert(error.message);
    else refreshMembers();
  };

  const pending = members.filter((m) => m.status === "pending");
  const approved = members.filter((m) => m.status === "approved");
  const removed = members.filter((m) => m.status === "removed");

  return (
    <div className="flex flex-1 flex-col gap-8 overflow-y-auto p-4 md:p-10">
      <div className="flex items-center gap-2">
        <IconShieldCog className="h-6 w-6 text-amber-400" />
        <h1 className="text-2xl font-bold text-neutral-800 dark:text-white">
          Admin Panel
        </h1>
      </div>

      <section>
        <h2 className="mb-3 font-semibold text-neutral-700 dark:text-neutral-200">
          Pending approvals{" "}
          {pending.length > 0 && (
            <span className="ml-1 rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">
              {pending.length}
            </span>
          )}
        </h2>
        <div className="flex flex-col gap-2">
          {pending.map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"
            >
              <UserBadge user={m} />
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => setStatus(m, "approved")}
                  className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500"
                >
                  <IconUserCheck className="h-4 w-4" /> Approve
                </button>
                <button
                  onClick={() => setStatus(m, "removed")}
                  className="flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500"
                >
                  <IconUserX className="h-4 w-4" /> Reject
                </button>
              </div>
            </div>
          ))}
          {pending.length === 0 && (
            <p className="text-sm text-neutral-500">No pending signups.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-neutral-700 dark:text-neutral-200">
          Team members
        </h2>
        <div className="flex flex-col gap-2">
          {approved.map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-gray-50 p-4 dark:border-neutral-700 dark:bg-neutral-800"
            >
              <UserBadge user={m} />
              <TagEditor user={m} onToggle={toggleTag} />
              <div className="ml-auto flex gap-2">
                {m.role === "member" ? (
                  <button
                    onClick={() => setRole(m, "admin")}
                    className="flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-500"
                  >
                    <IconUserUp className="h-4 w-4" /> Make admin
                  </button>
                ) : (
                  <button
                    onClick={() => setRole(m, "member")}
                    className="flex items-center gap-1 rounded-md bg-neutral-600 px-3 py-1.5 text-sm text-white hover:bg-neutral-500"
                  >
                    <IconUserDown className="h-4 w-4" /> Remove admin
                  </button>
                )}
                {m.id !== profile.id && (
                  <button
                    onClick={() => setStatus(m, "removed")}
                    className="flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500"
                  >
                    <IconUserX className="h-4 w-4" /> Remove access
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {removed.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold text-neutral-700 dark:text-neutral-200">
            Removed users
          </h2>
          <div className="flex flex-col gap-2">
            {removed.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-gray-50 p-4 opacity-70 dark:border-neutral-700 dark:bg-neutral-800"
              >
                <UserBadge user={m} />
                <button
                  onClick={() => setStatus(m, "approved")}
                  className="ml-auto flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500"
                >
                  <IconUserCheck className="h-4 w-4" /> Restore access
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function UserBadge({ user }: { user: Profile }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-600 text-sm font-bold text-white">
        {user.first_name?.[0]}
        {user.last_name?.[0]}
      </span>
      <div>
        <p className="font-medium text-neutral-800 dark:text-white">
          {user.first_name} {user.last_name}{" "}
          {user.role === "admin" && (
            <span className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500">
              ADMIN
            </span>
          )}
        </p>
        <p className="text-xs text-neutral-500">{user.email}</p>
        {user.tags && user.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {user.tags.map((tag) => (
              <span
                key={tag}
                className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium text-cyan-600 dark:text-cyan-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TagEditor({
  user,
  onToggle,
}: {
  user: Profile;
  onToggle: (user: Profile, tag: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentTags = user.tags || [];

  return (
    <div className="relative ml-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-cyan-500 dark:border-neutral-600 dark:text-neutral-300"
      >
        <IconTag className="h-3.5 w-3.5" />
        Tags ({currentTags.length}/{MAX_TAGS})
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
            {AVAILABLE_TAGS.map((tag) => (
              <label
                key={tag}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
              >
                <input
                  type="checkbox"
                  checked={currentTags.includes(tag)}
                  onChange={() => onToggle(user, tag)}
                  className="h-3.5 w-3.5 rounded accent-cyan-600"
                />
                {tag}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
