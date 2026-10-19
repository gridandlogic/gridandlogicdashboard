import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";

export type PushPayload = {
  userId: string; title: string; body?: string; url?: string;
  kind?: string; meetingId?: string;
};

export async function deliverPush(db: SupabaseClient, input: PushPayload) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new Error("VAPID keys are not configured on the app host.");
  webpush.setVapidDetails("mailto:noreply@gridandlogicdashboard.vercel.app", publicKey, privateKey);
  const { data: subscriptions, error } = await db.from("push_subscriptions")
    .select("id, endpoint, keys").eq("user_id", input.userId);
  if (error) throw new Error("Could not read device subscriptions.");
  const content = {
    title: input.title, body: input.body ?? "", url: input.url ?? "/dashboard",
    kind: input.kind ?? "message",
  };
  const tag = createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 32);
  const payload = JSON.stringify({
    ...content, tag, sentAt: Date.now(), icon: "/logo.svg", badge: "/logo.svg",
    meetingId: input.meetingId ?? (content.kind === "meeting_invite" ? content.url.split("/").pop() : undefined),
  });
  let sent = 0;
  let failed = 0;
  await Promise.all((subscriptions ?? []).map(async (subscription) => {
    try {
      await webpush.sendNotification(subscription, payload, {
        TTL: content.kind === "meeting_invite" ? 45 : 86400,
        urgency: "high", timeout: 10000,
      });
      sent++;
    } catch (error) {
      failed++;
      const status = (error as { statusCode?: number }).statusCode;
      console.error("Web Push delivery failed", { status, userId: input.userId });
      if (status === 404 || status === 410) {
        await db.from("push_subscriptions").delete().eq("id", subscription.id).eq("user_id", input.userId);
      }
    }
  }));
  return {
    success: sent > 0, sent, failed,
    error: !subscriptions?.length ? "No enabled device is registered for this recipient."
      : sent === 0 ? "The push service rejected delivery. Check the server VAPID keys and logs." : undefined,
  };
}
