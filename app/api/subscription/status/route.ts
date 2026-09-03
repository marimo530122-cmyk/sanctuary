/* =========================================================
   /api/subscription/status — 「今も本当にサブスク中か」をStripeへ
   直接問い合わせる。解約検知の実体はこのエンドポイントで、
   lib/billing.tsのrefreshSubscriptionStatus()が端末側から定期的
   （既定12時間おき）に呼び出す
   ---------------------------------------------------------
   ・STRIPE_SECRET_KEY未設定の間は501を返す。クライアント側は
     これを見て何もしない（＝従来通り、端末に解放が残り続ける）
   ========================================================= */

import { NextRequest, NextResponse } from "next/server";
import { CUSTOMER_ID_PATTERN } from "@/lib/stripe-shared";
import { listActiveSubscriptions } from "@/lib/stripe-server";

export async function GET(req: NextRequest) {
  const customerId = req.nextUrl.searchParams.get("customerId") || "";
  if (!CUSTOMER_ID_PATTERN.test(customerId)) {
    return NextResponse.json({ error: "invalid customerId" }, { status: 400 });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ error: "STRIPE_SECRET_KEY is not configured" }, { status: 501 });
  }

  try {
    const list = await listActiveSubscriptions(customerId, secretKey);
    const data = list?.data;
    const active = Array.isArray(data) && data.length > 0;
    return NextResponse.json({ active });
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
