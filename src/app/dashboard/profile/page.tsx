"use client";
import React, { useState } from "react";
import { useApp } from "@/components/providers/app-provider";
import { IconUser, IconDeviceFloppy } from "@tabler/icons-react";

export default function ProfilePage() {
  const { supabase, profile } = useApp();
  const [firstName, setFirstName] = useState(profile.first_name);
  const [lastName, setLastName] = useState(profile.last_name);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ first_name: firstName.trim(), last_name: lastName.trim() })
      .eq("id", profile.id);
    setSaving(false);
    if (error) alert(error.message);
    else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 md:p-10">
      <div className="flex items-center gap-2">
        <IconUser className="h-6 w-6 text-cyan-400" />
        <h1 className="text-2xl font-bold text-neutral-800 dark:text-white">
          My Profile
        </h1>
      </div>

      <div className="max-w-md rounded-xl border border-neutral-200 bg-gray-50 p-6 dark:border-neutral-700 dark:bg-neutral-800">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-cyan-600 text-xl font-bold text-white">
            {profile.first_name?.[0]}
            {profile.last_name?.[0]}
          </span>
          <div>
            <p className="font-semibold text-neutral-800 dark:text-white">
              {profile.first_name} {profile.last_name}
            </p>
            <p className="text-sm text-neutral-500">{profile.email}</p>
            <p className="mt-1 text-xs">
              <span
                className={`rounded px-1.5 py-0.5 font-semibold ${
                  profile.role === "admin"
                    ? "bg-amber-500/20 text-amber-500"
                    : "bg-cyan-500/20 text-cyan-500"
                }`}
              >
                {profile.role.toUpperCase()}
              </span>
            </p>
            {profile.tags && profile.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {profile.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-xs font-medium text-cyan-600 dark:text-cyan-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="First name"
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-cyan-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Last name"
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-cyan-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center justify-center gap-2 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            <IconDeviceFloppy className="h-4 w-4" />
            {saved ? "Saved!" : saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
