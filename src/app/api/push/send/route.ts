import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { deliverPush } from "@/lib/push/deliver";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, title, body: notifBody, url, kind, meetingId } = body as {
      userId: string;
      title: string;
      body?: string;
      url?: string;
      kind?: string;
      meetingId?: string;
    };

    if (!userId || !title) {
      return NextResponse.json({ error: "Missing userId or title" }, { status: 400 });
    }

    const webhookSecret = process.env.PUSH_WEBHOOK_SECRET;
    const suppliedSecret = req.headers.get("x-push-webhook-secret");
    const isTrustedWebhook = Boolean(webhookSecret && suppliedSecret === webhookSecret);
    if (suppliedSecret && !isTrustedWebhook) {
      console.error("Database push webhook rejected: PUSH_WEBHOOK_SECRET is missing or does not match the Supabase Vault secret.");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let supabase;
    if (isTrustedWebhook) {
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!serviceRoleKey || !supabaseUrl) {
        return NextResponse.json({ error: "Push webhook is not configured" }, { status: 500 });
      }
      supabase = createServiceClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    } else {
      supabase = await createClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        return NextResponse.json({ error: "Sign in before sending a notification." }, { status: 401 });
      }
      if (user.id !== userId) {
        return NextResponse.json({ error: "You can only send notifications to your own devices." }, { status: 403 });
      }
    }
    const result = await deliverPush(supabase, { userId, title, body: notifBody, url, kind, meetingId });
    return NextResponse.json(result, { status: result.failed && !result.sent ? 502 : 200 });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
