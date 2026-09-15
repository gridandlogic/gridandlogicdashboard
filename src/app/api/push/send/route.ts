import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import webpush from "web-push";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, title, body: notifBody, url } = body as {
      userId: string;
      title: string;
      body?: string;
      url?: string;
    };

    if (!userId || !title) {
      return NextResponse.json({ error: "Missing userId or title" }, { status: 400 });
    }

    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

    if (!vapidPublicKey || !vapidPrivateKey) {
      return NextResponse.json({ error: "VAPID keys not configured" }, { status: 500 });
    }

    webpush.setVapidDetails(
      "mailto:noreply@gridlogicdashboard.vercel.app",
      vapidPublicKey,
      vapidPrivateKey
    );

    const supabase = await createClient();
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", userId);

    if (!subs || subs.length === 0) {
      return NextResponse.json({ success: true, sent: 0 });
    }

    const payload = JSON.stringify({
      title,
      body: notifBody ?? "",
      url: url ?? "/dashboard",
      icon: "/logo.svg",
      badge: "/logo.svg",
    });

    let sent = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          payload
        );
        sent++;
      } catch (err) {
        // If subscription is expired, delete it
        if (err instanceof Error && err.message.includes("410")) {
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint);
        }
      }
    }

    return NextResponse.json({ success: true, sent });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
