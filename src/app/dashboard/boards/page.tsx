"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/providers/app-provider";
import type { Board } from "@/lib/types";
import { IconLayoutKanban, IconPlus, IconTrash } from "@tabler/icons-react";

export default function BoardsPage() {
  const { supabase, profile, isAdmin } = useApp();
  const [boards, setBoards] = useState<Board[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("boards")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setBoards(data as Board[]);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const createBoard = async () => {
    if (!name.trim()) return;
    const { error } = await supabase.from("boards").insert({
      name: name.trim(),
      description: description.trim() || null,
      created_by: profile.id,
    });
    if (error) alert(error.message);
    else {
      setName("");
      setDescription("");
      setShowForm(false);
      load();
    }
  };

  const deleteBoard = async (board: Board) => {
    if (!confirm(`Delete board "${board.name}" and all its tasks?`)) return;
    const { error } = await supabase.from("boards").delete().eq("id", board.id);
    if (error) alert(error.message);
    else load();
  };

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 md:p-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <IconLayoutKanban className="h-6 w-6 text-cyan-400" />
          <h1 className="text-2xl font-bold text-neutral-800 dark:text-white">
            Sprint Boards
          </h1>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-2 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
        >
          <IconPlus className="h-4 w-4" /> New Board
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-neutral-200 bg-gray-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
          <div className="flex flex-col gap-3 md:flex-row">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sprint name (e.g. Sprint 12 — Website revamp)"
              className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-cyan-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-cyan-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            />
            <button
              onClick={createBoard}
              className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
            >
              Create
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {boards.map((b) => (
          <div
            key={b.id}
            className="group relative rounded-xl border border-neutral-200 bg-gray-50 p-5 transition hover:border-cyan-500/50 dark:border-neutral-700 dark:bg-neutral-800"
          >
            <Link href={`/dashboard/boards/${b.id}`} className="block">
              <h2 className="font-semibold text-neutral-800 dark:text-white">
                {b.name}
              </h2>
              <p className="mt-1 line-clamp-2 text-sm text-neutral-500 dark:text-neutral-400">
                {b.description || "No description"}
              </p>
            </Link>
            {(isAdmin || b.created_by === profile.id) && (
              <button
                onClick={() => deleteBoard(b)}
                className="absolute top-3 right-3 hidden text-neutral-400 hover:text-red-500 group-hover:block"
                title="Delete board"
              >
                <IconTrash className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {boards.length === 0 && (
          <p className="text-sm text-neutral-500">
            No boards yet. Create your first sprint board.
          </p>
        )}
      </div>
    </div>
  );
}
