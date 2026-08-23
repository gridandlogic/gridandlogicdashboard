"use client";
import React, { useRef, useState } from "react";
import { useApp } from "@/components/providers/app-provider";
import {
  IconSend,
  IconPaperclip,
  IconMicrophone,
  IconPlayerStopFilled,
  IconX,
  IconFile,
} from "@tabler/icons-react";

export function MessageInput({
  onSend,
}: {
  onSend: (payload: {
    content: string | null;
    kind: "text" | "file" | "audio";
    file_url: string | null;
    file_name: string | null;
    file_type: string | null;
  }) => Promise<void>;
}) {
  const { supabase, profile } = useApp();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const uploadFile = async (f: File | Blob, name: string): Promise<string | null> => {
    const path = `${profile.id}/${Date.now()}-${name}`;
    const { error } = await supabase.storage.from("attachments").upload(path, f);
    if (error) {
      alert("Upload failed: " + error.message);
      return null;
    }
    const { data } = supabase.storage.from("attachments").getPublicUrl(path);
    return data.publicUrl;
  };

  const send = async () => {
    if (sending) return;
    if (!text.trim() && !file) return;
    setSending(true);
    try {
      if (file) {
        const url = await uploadFile(file, file.name);
        if (url) {
          await onSend({
            content: text.trim() || null,
            kind: "file",
            file_url: url,
            file_name: file.name,
            file_type: file.type || "application/octet-stream",
          });
        }
      } else {
        await onSend({
          content: text.trim(),
          kind: "text",
          file_url: null,
          file_name: null,
          file_type: null,
        });
      }
      setText("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setSending(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size > 0) {
          setSending(true);
          const url = await uploadFile(blob, `voice-message.webm`);
          if (url) {
            await onSend({
              content: null,
              kind: "audio",
              file_url: url,
              file_name: "Voice message",
              file_type: "audio/webm",
            });
          }
          setSending(false);
        }
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      alert("Microphone access denied.");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current) {
      chunksRef.current = [];
      mediaRecorderRef.current.onstop = () => {};
      mediaRecorderRef.current.stream?.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  return (
    <div className="border-t border-neutral-200 p-3 dark:border-neutral-700">
      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-800">
          <IconFile className="h-4 w-4 text-neutral-500" />
          <span className="truncate text-neutral-700 dark:text-neutral-300">
            {file.name}
          </span>
          <button
            onClick={() => {
              setFile(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            className="ml-auto text-neutral-500 hover:text-red-500"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
      )}

      {recording ? (
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-sm text-red-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            Recording… {Math.floor(recordSeconds / 60)}:
            {String(recordSeconds % 60).padStart(2, "0")}
          </span>
          <button
            onClick={cancelRecording}
            className="ml-auto rounded-full p-2 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            title="Cancel"
          >
            <IconX className="h-5 w-5" />
          </button>
          <button
            onClick={stopRecording}
            className="rounded-full bg-cyan-600 p-2 text-white hover:bg-cyan-500"
            title="Send voice message"
          >
            <IconPlayerStopFilled className="h-5 w-5" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full p-2 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            title="Attach file"
          >
            <IconPaperclip className="h-5 w-5" />
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Type a message… (links are auto-detected)"
            className="flex-1 rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-900 outline-none focus:border-cyan-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
          />
          {text.trim() || file ? (
            <button
              onClick={send}
              disabled={sending}
              className="rounded-full bg-cyan-600 p-2 text-white hover:bg-cyan-500 disabled:opacity-50"
              title="Send"
            >
              <IconSend className="h-5 w-5" />
            </button>
          ) : (
            <button
              onClick={startRecording}
              className="rounded-full bg-cyan-600 p-2 text-white hover:bg-cyan-500"
              title="Record voice message"
            >
              <IconMicrophone className="h-5 w-5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
