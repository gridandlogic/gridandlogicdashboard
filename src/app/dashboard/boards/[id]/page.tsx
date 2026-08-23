"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/components/providers/app-provider";
import type { Board, Task, TaskComment } from "@/lib/types";
import {
  IconArrowLeft,
  IconPlus,
  IconTrash,
  IconX,
  IconMessage,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";

const COLUMNS: { key: Task["status"]; label: string; color: string }[] = [
  { key: "todo", label: "To Do", color: "bg-neutral-500" },
  { key: "in_progress", label: "In Progress", color: "bg-blue-500" },
  { key: "review", label: "Review", color: "bg-amber-500" },
  { key: "done", label: "Done", color: "bg-emerald-500" },
];

export default function BoardDetailPage() {
  const params = useParams<{ id: string }>();
  const boardId = params.id;
  const { supabase, profile, isAdmin, members } = useApp();
  const [board, setBoard] = useState<Board | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");

  const loadTasks = useCallback(async () => {
    const { data } = await supabase
      .from("tasks")
      .select("*")
      .eq("board_id", boardId)
      .order("created_at");
    if (data) setTasks(data as Task[]);
  }, [supabase, boardId]);

  useEffect(() => {
    supabase
      .from("boards")
      .select("*")
      .eq("id", boardId)
      .single()
      .then(({ data }) => setBoard(data as Board));
    loadTasks();

    const ch = supabase
      .channel(`board-${boardId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `board_id=eq.${boardId}` },
        () => loadTasks()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, boardId, loadTasks]);

  const createTask = async () => {
    if (!title.trim()) return;
    const { error } = await supabase.from("tasks").insert({
      board_id: boardId,
      title: title.trim(),
      description: description.trim() || null,
      assignee_id: assignee || null,
      created_by: profile.id,
      status: "todo",
    });
    if (error) alert(error.message);
    else {
      if (assignee && assignee !== profile.id) {
        await supabase.from("notifications").insert({
          user_id: assignee,
          type: "task_assigned",
          title: "New task assigned to you",
          body: `${profile.first_name} assigned you "${title.trim()}"`,
          link: `/dashboard/boards/${boardId}`,
        });
      }
      setTitle("");
      setDescription("");
      setAssignee("");
      setShowForm(false);
    }
  };

  const moveTask = async (task: Task, dir: -1 | 1) => {
    const idx = COLUMNS.findIndex((c) => c.key === task.status);
    const next = COLUMNS[idx + dir];
    if (!next) return;
    await supabase.from("tasks").update({ status: next.key }).eq("id", task.id);
  };

  const deleteTask = async (task: Task) => {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    await supabase.from("tasks").delete().eq("id", task.id);
  };

  const memberName = (id: string | null) => {
    if (!id) return "Unassigned";
    const m = members.find((x) => x.id === id);
    return m ? `${m.first_name} ${m.last_name}` : "Unknown";
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-200 p-4 dark:border-neutral-700">
        <Link href="/dashboard/boards" className="text-neutral-500 hover:text-cyan-500">
          <IconArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-bold text-neutral-800 dark:text-white">
          {board?.name ?? "…"}
        </h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="ml-auto flex items-center gap-2 rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500"
        >
          <IconPlus className="h-4 w-4" /> Task
        </button>
      </div>

      {showForm && (
        <div className="border-b border-neutral-200 p-4 dark:border-neutral-700">
          <div className="flex flex-col gap-2 md:flex-row">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-cyan-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-cyan-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
            />
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
            >
              <option value="">Unassigned</option>
              {members
                .filter((m) => m.status === "approved")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.first_name} {m.last_name}
                  </option>
                ))}
            </select>
            <button
              onClick={createTask}
              className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Kanban columns */}
      <div className="flex flex-1 gap-4 overflow-x-auto p-4">
        {COLUMNS.map((col) => (
          <div
            key={col.key}
            className="flex w-72 shrink-0 flex-col rounded-xl bg-gray-50 dark:bg-neutral-800"
          >
            <div className="flex items-center gap-2 p-3">
              <span className={`h-2.5 w-2.5 rounded-full ${col.color}`} />
              <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">
                {col.label}
              </h3>
              <span className="ml-auto text-xs text-neutral-500">
                {tasks.filter((t) => t.status === col.key).length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
              {tasks
                .filter((t) => t.status === col.key)
                .map((t) => (
                  <div
                    key={t.id}
                    className="group rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        onClick={() => setOpenTask(t)}
                        className="text-left text-sm font-medium text-neutral-800 hover:text-cyan-500 dark:text-white"
                      >
                        {t.title}
                      </button>
                      {(isAdmin || t.created_by === profile.id) && (
                        <button
                          onClick={() => deleteTask(t)}
                          className="hidden shrink-0 text-neutral-400 hover:text-red-500 group-hover:block"
                        >
                          <IconTrash className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {t.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-neutral-500">
                        {t.description}
                      </p>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          t.assignee_id === profile.id
                            ? "bg-cyan-500/20 text-cyan-500"
                            : "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
                        }`}
                      >
                        {memberName(t.assignee_id)}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => moveTask(t, -1)}
                          disabled={col.key === "todo"}
                          className="text-neutral-400 hover:text-cyan-500 disabled:opacity-20"
                          title="Move left"
                        >
                          <IconChevronLeft className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setOpenTask(t)}
                          className="text-neutral-400 hover:text-cyan-500"
                          title="Comments"
                        >
                          <IconMessage className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => moveTask(t, 1)}
                          disabled={col.key === "done"}
                          className="text-neutral-400 hover:text-cyan-500 disabled:opacity-20"
                          title="Move right"
                        >
                          <IconChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      {openTask && (
        <TaskModal
          task={openTask}
          onClose={() => setOpenTask(null)}
          memberName={memberName}
        />
      )}
    </div>
  );
}

function TaskModal({
  task,
  onClose,
  memberName,
}: {
  task: Task;
  onClose: () => void;
  memberName: (id: string | null) => string;
}) {
  const { supabase, profile, isAdmin } = useApp();
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [text, setText] = useState("");

  const canComment = isAdmin || task.assignee_id === profile.id;

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("task_comments")
      .select("*")
      .eq("task_id", task.id)
      .order("created_at");
    if (data) setComments(data as TaskComment[]);
  }, [supabase, task.id]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`task-comments-${task.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "task_comments",
          filter: `task_id=eq.${task.id}`,
        },
        (payload) => setComments((prev) => [...prev, payload.new as TaskComment])
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, task.id, load]);

  const addComment = async () => {
    if (!text.trim()) return;
    const { error } = await supabase.from("task_comments").insert({
      task_id: task.id,
      author_id: profile.id,
      content: text.trim(),
    });
    if (error) alert(error.message);
    else setText("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl bg-white dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-neutral-200 p-4 dark:border-neutral-700">
          <div>
            <h2 className="font-bold text-neutral-800 dark:text-white">{task.title}</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Assigned to: {memberName(task.assignee_id)}
            </p>
            {task.description && (
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
                {task.description}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-red-500">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            Comments
          </h3>
          <div className="flex flex-col gap-3">
            {comments.map((c) => (
              <div
                key={c.id}
                className="rounded-lg bg-neutral-100 p-3 dark:bg-neutral-800"
              >
                <p className="text-xs font-semibold text-cyan-500">
                  {memberName(c.author_id)}
                </p>
                <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-200">
                  {c.content}
                </p>
              </div>
            ))}
            {comments.length === 0 && (
              <p className="text-sm text-neutral-500">No comments yet.</p>
            )}
          </div>
        </div>

        <div className="border-t border-neutral-200 p-3 dark:border-neutral-700">
          {canComment ? (
            <div className="flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addComment()}
                placeholder="Write a comment…"
                className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-cyan-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
              />
              <button
                onClick={addComment}
                className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
              >
                Send
              </button>
            </div>
          ) : (
            <p className="text-center text-xs text-neutral-500">
              Only the task assignee and admins can comment on this task.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
