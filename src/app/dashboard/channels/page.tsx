"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/providers/app-provider";
import { MessageList } from "@/components/chat/message-list";
import { MessageInput } from "@/components/chat/message-input";
import type { Channel, Message } from "@/lib/types";
import {
  IconHash,
  IconPlus,
  IconTrash,
  IconArrowLeft,
} from "@tabler/icons-react";

export default function ChannelsPage() {
  const { supabase, profile, isAdmin, members } = useApp();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newChannelName, setNewChannelName] = useState("");
  const [creating, setCreating] = useState(false);

  const loadChannels = useCallback(async () => {
    const { data } = await supabase.from("channels").select("*").order("name");
    if (data) setChannels(data as Channel[]);
  }, [supabase]);

  useEffect(() => {
    loadChannels();
    const ch = supabase
      .channel("channels-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "channels" },
        () => loadChannels()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, loadChannels]);

  useEffect(() => {
    if (!selected) return;
    let active = true;

    supabase
      .from("messages")
      .select("*")
      .eq("channel_id", selected.id)
      .order("created_at")
      .then(({ data }) => {
        if (active && data) setMessages(data as Message[]);
      });

    const ch = supabase
      .channel(`channel-msgs-${selected.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${selected.id}`,
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

  const createChannel = async () => {
    const name = newChannelName.trim().toLowerCase().replace(/\s+/g, "-");
    if (!name) return;
    setCreating(true);
    const { error } = await supabase
      .from("channels")
      .insert({ name, created_by: profile.id });
    setCreating(false);
    if (error) alert(error.message);
    else setNewChannelName("");
  };

  const deleteChannel = async (channel: Channel) => {
    if (!confirm(`Delete #${channel.name}? All its messages will be lost.`)) return;
    const { error } = await supabase.from("channels").delete().eq("id", channel.id);
    if (error) alert(error.message);
    if (selected?.id === channel.id) setSelected(null);
  };

  const sendMessage = async (payload: {
    content: string | null;
    kind: "text" | "file" | "audio";
    file_url: string | null;
    file_name: string | null;
    file_type: string | null;
  }) => {
    if (!selected) return;
    const { error } = await supabase.from("messages").insert({
      channel_id: selected.id,
      sender_id: profile.id,
      ...payload,
    });
    if (error) alert(error.message);
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Channel list */}
      <div
        className={`${
          selected ? "hidden md:flex" : "flex"
        } w-full flex-col border-r border-neutral-200 md:w-72 dark:border-neutral-700`}
      >
        <div className="border-b border-neutral-200 p-4 dark:border-neutral-700">
          <h1 className="text-lg font-bold text-neutral-800 dark:text-white">
            Channels
          </h1>
          {isAdmin && (
            <div className="mt-3 flex gap-2">
              <input
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createChannel()}
                placeholder="new-channel"
                className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 outline-none focus:border-cyan-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
              />
              <button
                onClick={createChannel}
                disabled={creating}
                className="rounded-md bg-cyan-600 px-2 text-white hover:bg-cyan-500 disabled:opacity-50"
                title="Create channel (admin)"
              >
                <IconPlus className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {channels.map((c) => (
            <div
              key={c.id}
              className={`group flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ${
                selected?.id === c.id
                  ? "bg-cyan-600/10 text-cyan-500"
                  : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
              onClick={() => setSelected(c)}
            >
              <IconHash className="h-4 w-4 shrink-0" />
              <span className="truncate">{c.name}</span>
              {isAdmin && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteChannel(c);
                  }}
                  className="ml-auto hidden text-neutral-400 hover:text-red-500 group-hover:block"
                  title="Delete channel (admin)"
                >
                  <IconTrash className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {channels.length === 0 && (
            <p className="p-3 text-sm text-neutral-500">
              No channels yet.{isAdmin ? " Create one above." : " Ask an admin to create one."}
            </p>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className={`${selected ? "flex" : "hidden md:flex"} flex-1 flex-col`}>
        {selected ? (
          <>
            <div className="flex items-center gap-2 border-b border-neutral-200 p-4 dark:border-neutral-700">
              <button
                className="md:hidden text-neutral-500"
                onClick={() => setSelected(null)}
              >
                <IconArrowLeft className="h-5 w-5" />
              </button>
              <IconHash className="h-5 w-5 text-cyan-500" />
              <h2 className="font-semibold text-neutral-800 dark:text-white">
                {selected.name}
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
          <div className="flex flex-1 items-center justify-center text-neutral-500">
            Select a channel to start chatting
          </div>
        )}
      </div>
    </div>
  );
}
