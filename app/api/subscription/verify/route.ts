/* =========================================================
   /api/subscription/verify — 決済リンクから戻ってきた直後、
   本当にStripe側で支払いが完了しているかをサーバー側で確認する
   ---------------------------------------------------------
   ・STRIPE_SECRET_KEY未設定の間は、これまで通り「リダイレクトの
     session_idの形式だけを信じる」簡易動作にフォールバックする
     （verified:falseを返す。クライアント側はこれを見て従来通り解放する）
   ========================================================= */

import { NextRequest, NextResponse } from "next/server";
import { SESSION_ID_PATTERN } from "@/lib/stripe-shared";
import { retrieveCheckoutSession, isActiveStatus } from "@/lib/stripe-server";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id") || "";
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ ok: true, verified: false, active: null, customerId: null });
  }

  try {
    const session = await retrieveCheckoutSession(sessionId, secretKey);
    const subscription = session?.subscription as { status?: unknown } | undefined;
    const customerId = typeof session?.customer === "string" ? session.customer : null;
    const active = isActiveStatus(subscription?.status);

    if (!active || !customerId) {
      return NextResponse.json({ ok: true, verified: true, active: false, customerId: null });
    }
    return NextResponse.json({ ok: true, verified: true, active: true, customerId });
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
