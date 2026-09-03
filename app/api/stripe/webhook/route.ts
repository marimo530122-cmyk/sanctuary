/* =========================================================
   /api/stripe/webhook — Stripeからの解約・更新イベント受信
   ---------------------------------------------------------
   ⚠️ 正直な限界: このプロジェクトにはデータベースが無いため、
   ここで受け取ったイベントを永続化して他のリクエストに即座に
   反映する仕組みは無い（サーバーレス関数は呼び出しごとに状態を
   保持しない）。実際の「解約されたら締め出す」動作は、
   app/api/subscription/status が端末側からの問い合わせのたびに
   Stripeへ直接確認することで実現している
   （lib/billing.tsのrefreshSubscriptionStatus、既定12時間おき）。

   このWebhookは (1) 署名を検証して本物のStripeイベントであることを
   確認し、(2) 何が起きたかをサーバーログに残す、という最小限の
   役割にとどめている。将来、解約の即時反映が必要になったら、ここで
   KV/DBに状態を書き込み、statusエンドポイント側もまずそのキャッシュ
   を見るようにするとよい（現状は意図的にその一歩手前で止めている）。
   ========================================================= */

import { NextRequest, NextResponse } from "next/server";
import { verifyStripeSignature } from "@/lib/stripe-server";

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET is not configured" }, { status: 501 });
  }

  const signature = req.headers.get("stripe-signature") || "";
  const rawBody = await req.text();

  if (!verifyStripeSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const type = event.type || "unknown";
  const obj = event.data?.object || {};
  console.log(`[stripe webhook] ${type} customer=${obj.customer ?? "?"} status=${obj.status ?? "-"}`);

  return NextResponse.json({ received: true });
}
