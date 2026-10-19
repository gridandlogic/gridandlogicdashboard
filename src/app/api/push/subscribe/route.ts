import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { subscription, userId } = body as {
      subscription: { endpoint: string; keys: Record<string, string> };
      userId: string;
    };

    if (!subscription?.endpoint || !userId) {
      return NextResponse.json({ error: "Missing subscription or userId" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Sign in before enabling notifications." }, { status: 401 });
    }
    if (user.id !== userId) {
      return NextResponse.json({ error: "You can only save your own notification settings." }, { status: 403 });
    }

    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: userId,
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        },
        { onConflict: "user_id,endpoint" }
      );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const endpoint = searchParams.get("endpoint");
    const userId = searchParams.get("userId");

    if (!endpoint || !userId) {
      return NextResponse.json({ error: "Missing endpoint or userId" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Sign in before changing notification settings." }, { status: 401 });
    }
    if (user.id !== userId) {
      return NextResponse.json({ error: "You can only change your own notification settings." }, { status: 403 });
    }

    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", endpoint);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
