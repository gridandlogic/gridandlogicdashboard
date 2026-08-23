"use client";
import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApp } from "@/components/providers/app-provider";
import { MessageList } from "@/components/chat/message-list";
import { MessageInput } from "@/components/chat/message-input";
import type { Conversation, Message, Profile } from "@/lib/types";
import { IconArrowLeft, IconMessageCircle } from "@tabler/icons-react";

export default function DMPage() {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center text-neutral-500">Loading…</div>}>
      <DMContent />
    </Suspense>
  );
}

function DMContent() {
  const { supabase, profile, members } = useApp();
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  const otherOf = useCallback(
    (c: Conversation): Profile | undefined => {
      const otherId = c.user1 === profile.id ? c.user2 : c.user1;
      return members.find((m) => m.id === otherId);
    },
    [members, profile.id]
  );

  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from("conversations")
      .select("*")
      .or(`user1.eq.${profile.id},user2.eq.${profile.id}`)
      .order("created_at", { ascending: false });
    if (data) setConversations(data as Conversation[]);
    return (data ?? []) as Conversation[];
  }, [supabase, profile.id]);

  const openConversationWith = useCallback(
    async (userId: string) => {
      if (userId === profile.id) return;
      const convs = await loadConversations();
      const existing = convs.find(
        (c) =>
          (c.user1 === profile.id && c.user2 === userId) ||
          (c.user2 === profile.id && c.user1 === userId)
      );
      if (existing) {
        setSelected(existing);
        return;
      }
      const { data, error } = await supabase
        .from("conversations")
        .insert({ user1: profile.id, user2: userId })
        .select()
        .single();
      if (error) {
        alert(error.message);
        return;
      }
      await loadConversations();
      setSelected(data as Conversation);
    },
    [supabase, profile.id, loadConversations]
  );

  useEffect(() => {
    loadConversations().then(() => {
      const userParam = searchParams.get("user");
      if (userParam) openConversationWith(userParam);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    let active = true;

    supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", selected.id)
      .order("created_at")
      .then(({ data }) => {
        if (active && data) setMessages(data as Message[]);
      });

    const ch = supabase
      .channel(`dm-msgs-${selected.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selected.id}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [supabase, selected]);

  const sendMessage = async (payload: {
    content: string | null;
    kind: "text" | "file" | "audio";
    file_url: string | null;
    file_name: string | null;
    file_type: string | null;
  }) => {
    if (!selected) return;
    const { error } = await supabase.from("messages").insert({
      conversation_id: selected.id,
      sender_id: profile.id,
      ...payload,
    });
    if (error) alert(error.message);
  };

  const other = selected ? otherOf(selected) : undefined;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* People / conversations list */}
      <div
        className={`${
          selected ? "hidden md:flex" : "flex"
        } w-full flex-col border-r border-neutral-200 md:w-72 dark:border-neutral-700`}
      >
        <div className="border-b border-neutral-200 p-4 dark:border-neutral-700">
          <h1 className="text-lg font-bold text-neutral-800 dark:text-white">
            Direct Messages
          </h1>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {members
            .filter((m) => m.id !== profile.id && m.status === "approved")
            .map((m) => (
              <button
                key={m.id}
                onClick={() => openConversationWith(m.id)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${
                  other?.id === m.id
                    ? "bg-cyan-600/10 text-cyan-500"
                    : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-600 text-xs font-bold text-white">
                  {m.first_name?.[0]}
                  {m.last_name?.[0]}
                </span>
                <span className="truncate">
                  {m.first_name} {m.last_name}
                </span>
              </button>
            ))}
        </div>
      </div>

      {/* Chat area */}
      <div className={`${selected ? "flex" : "hidden md:flex"} flex-1 flex-col`}>
        {selected && other ? (
          <>
            <div className="flex items-center gap-3 border-b border-neutral-200 p-4 dark:border-neutral-700">
              <button
                className="md:hidden text-neutral-500"
                onClick={() => setSelected(null)}
              >
                <IconArrowLeft className="h-5 w-5" />
              </button>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-600 text-xs font-bold text-white">
                {other.first_name?.[0]}
                {other.last_name?.[0]}
              </span>
              <h2 className="font-semibold text-neutral-800 dark:text-white">
                {other.first_name} {other.last_name}
              </h2>
            </div>
            <MessageList
              messages={messages}
              members={members}
              currentUserId={profile.id}
            />
            <MessageInput onSend={sendMessage} />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-500">
            <IconMessageCircle className="h-10 w-10" />
            Pick a teammate to start a direct conversation
          </div>
        )}
      </div>
    </div>
  );
}
