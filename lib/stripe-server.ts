/* =========================================================
   Stripe REST APIの薄いラッパー（サーバー専用・クライアントから import しないこと）
   ---------------------------------------------------------
   ・このプロジェクトは外部SDKを増やさない方針（/api/chat, /api/tts と
     同様、生のfetchで直接REST APIを叩く）。Stripe公式SDKも使わない
   ・Webhook署名検証もStripe公式の仕様（t=timestamp,v1=signature の
     組み合わせをHMAC-SHA256で照合）をNode標準のcryptoで自前実装した
   ========================================================= */

import crypto from "crypto";

const STRIPE_API = "https://api.stripe.com/v1";
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

async function stripeGet(path: string, secretKey: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function retrieveCheckoutSession(sessionId: string, secretKey: string) {
  return stripeGet(`/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`, secretKey);
}

export async function listActiveSubscriptions(customerId: string, secretKey: string) {
  return stripeGet(
    `/subscriptions?customer=${encodeURIComponent(customerId)}&status=active&limit=1`,
    secretKey
  );
}

export function isActiveStatus(status: unknown): boolean {
  return typeof status === "string" && ACTIVE_STATUSES.has(status);
}

// StripeのWebhook署名検証。タイミング攻撃を避けるためtimingSafeEqualで比較し、
// 5分より古いイベントはリプレイ攻撃防止のため拒否する
export function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const parts: Record<string, string> = {};
  for (const kv of signatureHeader.split(",")) {
    const [k, v] = kv.split("=");
    if (k && v) parts[k] = v;
  }
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const signatureBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}
