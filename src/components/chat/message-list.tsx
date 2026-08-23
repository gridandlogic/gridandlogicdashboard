"use client";
import React, { useEffect, useRef } from "react";
import type { Message, Profile } from "@/lib/types";
import { formatDate, formatTime, linkify } from "@/lib/utils";
import {
  IconFile,
  IconDownload,
  IconPhoto,
} from "@tabler/icons-react";

export function MessageList({
  messages,
  members,
  currentUserId,
}: {
  messages: Message[];
  members: Profile[];
  currentUserId: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const getSender = (id: string) => members.find((m) => m.id === id);

  let lastDate = "";

  return (
    <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-4">
      {messages.map((msg) => {
        const sender = getSender(msg.sender_id);
        const mine = msg.sender_id === currentUserId;
        const dateLabel = formatDate(msg.created_at);
        const showDate = dateLabel !== lastDate;
        lastDate = dateLabel;

        return (
          <React.Fragment key={msg.id}>
            {showDate && (
              <div className="my-3 flex items-center justify-center">
                <span className="rounded-full bg-neutral-200 px-3 py-1 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                  {dateLabel}
                </span>
              </div>
            )}
            <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 md:max-w-[65%] ${
                  mine
                    ? "rounded-br-sm bg-cyan-700 text-white"
                    : "rounded-bl-sm bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                }`}
              >
                {!mine && (
                  <p className="text-xs font-semibold text-cyan-500">
                    {sender ? `${sender.first_name} ${sender.last_name}` : "Unknown"}
                  </p>
                )}
                <MessageBody msg={msg} mine={mine} />
                <p
                  className={`mt-0.5 text-right text-[10px] ${
                    mine ? "text-cyan-200" : "text-neutral-500"
                  }`}
                >
                  {formatTime(msg.created_at)}
                </p>
              </div>
            </div>
          </React.Fragment>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

function MessageBody({ msg, mine }: { msg: Message; mine: boolean }) {
  if (msg.kind === "audio" && msg.file_url) {
    return (
      <audio controls preload="metadata" className="mt-1 max-w-full" style={{ height: 40 }}>
        <source src={msg.file_url} />
      </audio>
    );
  }

  if (msg.kind === "file" && msg.file_url) {
    const isImage = msg.file_type?.startsWith("image/");
    const isVideo = msg.file_type?.startsWith("video/");
    return (
      <div className="mt-1">
        {isImage ? (
          <a href={msg.file_url} target="_blank" rel="noreferrer">
            <img
              src={msg.file_url}
              alt={msg.file_name ?? "image"}
              className="max-h-64 rounded-lg object-cover"
            />
          </a>
        ) : isVideo ? (
          <video controls className="max-h-64 rounded-lg" src={msg.file_url} />
        ) : (
          <a
            href={msg.file_url}
            target="_blank"
            rel="noreferrer"
            download={msg.file_name ?? true}
            className={`flex items-center gap-2 rounded-lg p-2 ${
              mine ? "bg-cyan-800" : "bg-neutral-300 dark:bg-neutral-700"
            }`}
          >
            {msg.file_type?.startsWith("image/") ? (
              <IconPhoto className="h-6 w-6 shrink-0" />
            ) : (
              <IconFile className="h-6 w-6 shrink-0" />
            )}
            <span className="truncate text-sm">{msg.file_name ?? "File"}</span>
            <IconDownload className="ml-auto h-4 w-4 shrink-0" />
          </a>
        )}
        {msg.content && <TextContent content={msg.content} mine={mine} />}
      </div>
    );
  }

  return msg.content ? <TextContent content={msg.content} mine={mine} /> : null;
}

function TextContent({ content, mine }: { content: string; mine: boolean }) {
  const parts = linkify(content);
  return (
    <p className="text-sm break-words whitespace-pre-wrap">
      {parts.map((part, i) =>
        typeof part === "string" ? (
          <span key={i}>{part}</span>
        ) : (
          <a
            key={i}
            href={part.url}
            target="_blank"
            rel="noreferrer"
            className={`underline ${mine ? "text-cyan-100" : "text-cyan-500"}`}
          >
            {part.url}
          </a>
        )
      )}
    </p>
  );
}
