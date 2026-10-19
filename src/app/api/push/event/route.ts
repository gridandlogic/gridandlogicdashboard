import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { deliverPush, type PushPayload } from "@/lib/push/deliver";

export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Clients provide only event IDs. Recipient and notification text come from stored records.
export async function POST(request: NextRequest) {
  try {
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in to send alerts." }, { status: 401 });
    const { data: actor } = await db.from("profiles").select("first_name,last_name,status").eq("id", user.id).single();
    if (actor?.status !== "approved") return NextResponse.json({ error: "Account approval is required." }, { status: 403 });
    const event = await request.json();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!serviceKey || !serviceUrl) return NextResponse.json({ error: "Notification delivery needs SUPABASE_SERVICE_ROLE_KEY on the app host." }, { status: 503 });
    const service = createServiceClient(serviceUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const name = [actor.first_name, actor.last_name].filter(Boolean).join(" ") || "A teammate";
    let payload: PushPayload;
    let notificationId: string | undefined;

    if (event.type === "dm" && typeof event.messageId === "string" && uuid.test(event.messageId)) {
      const { data: message } = await db.from("messages").select("*").eq("id", event.messageId).single();
      if (!message || message.sender_id !== user.id || !message.conversation_id ||
          Date.now() - Date.parse(message.created_at) > 120000) {
        return NextResponse.json({ error: "This message cannot be used to send an alert." }, { status: 403 });
      }
      const { data: conversation } = await db.from("conversations").select("user1,user2").eq("id", message.conversation_id).single();
      if (!conversation || ![conversation.user1, conversation.user2].includes(user.id)) {
        return NextResponse.json({ error: "Conversation access denied." }, { status: 403 });
      }
      payload = {
        userId: conversation.user1 === user.id ? conversation.user2 : conversation.user1,
        title: "💬 New message from " + [actor.first_name, actor.last_name].join(" "),
        body: message.kind === "audio" ? "🎤 Voice message" : message.kind === "file"
          ? "📎 " + (message.file_name || "File") : (message.content || "").slice(0, 80),
        url: "/dashboard/dm", kind: "dm",
      };
    } else if (event.type === "meeting_invite" && typeof event.meetingId === "string" &&
        uuid.test(event.meetingId) && typeof event.userId === "string" && uuid.test(event.userId)) {
      const { data: meeting } = await db.from("meetings").select("id,title,status,created_by").eq("id", event.meetingId).single();
      if (!meeting || meeting.status !== "live") return NextResponse.json({ error: "This meeting has ended." }, { status: 409 });
      if (meeting.created_by !== user.id) {
        const { data: participant } = await db.from("meeting_participants").select("joined_at")
          .eq("meeting_id", meeting.id).eq("user_id", user.id).maybeSingle();
        if (!participant?.joined_at) return NextResponse.json({ error: "Join the meeting before inviting teammates." }, { status: 403 });
      }
      const { data: recipient } = await db.from("profiles").select("status").eq("id", event.userId).single();
      if (recipient?.status !== "approved" || event.userId === user.id) return NextResponse.json({ error: "Choose an approved teammate." }, { status: 400 });
      payload = {
        userId: event.userId, title: "📹 Meeting Call",
        body: name + ' is calling you to join "' + meeting.title + '"',
        url: "/dashboard/meetings/" + meeting.id, kind: "meeting_invite", meetingId: meeting.id,
      };
      const { data: recent, error: recentError } = await service.from("notifications").select("id")
        .eq("user_id", payload.userId).eq("type", "meeting_invite").eq("link", payload.url!)
        .eq("body", payload.body!).gte("created_at", new Date(Date.now() - 10000).toISOString()).limit(1);
      if (recentError) throw new Error("Could not check recent invites.");
      if (recent?.length) return NextResponse.json({ error: "Please wait a few seconds before calling again." }, { status: 429 });
      const { error: participantError } = await service.from("meeting_participants").upsert(
        { meeting_id: meeting.id, user_id: payload.userId, invited: true }, { onConflict: "meeting_id,user_id" });
      if (participantError) throw new Error("Could not save the invitation.");
      const { data: notification, error } = await service.from("notifications").insert({
        user_id: payload.userId, title: payload.title, body: payload.body, type: payload.kind, link: payload.url,
      }).select("id").single();
      if (error) throw new Error("Could not save the call notification.");
      notificationId = notification.id;
    } else {
      return NextResponse.json({ error: "Invalid notification event." }, { status: 400 });
    }
    try {
      const result = await deliverPush(service, payload);
      return NextResponse.json({ ...result, notificationId });
    } catch (error) {
      console.error("Event push failed", error);
      return NextResponse.json({ sent: 0, failed: 1, notificationId, error: "The event was saved, but push delivery is unavailable. Check the app host notification configuration." }, { status: 502 });
    }
  } catch (error) {
    console.error("Notification event failed", error);
    return NextResponse.json({ error: "Could not process the notification event." }, { status: 500 });
  }
}
