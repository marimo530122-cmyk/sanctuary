/* =========================================================
   💎 月額課金（Stripe決済リンク・サーバー不要版）
   ---------------------------------------------------------
   batuge-mu（バツルーレット）プロジェクトのbilling.jsと同じ
   方式。決済完了後のリダイレクト（?paid=1&session_id=...）を
   検知して、端末のlocalStorageに「サブスク中」を記録する。

   ⚠️ 正直な限界: サブスクリプションが実際に「今も有効か」を
   サーバー側でStripeに問い合わせているわけではないため、
   本当の意味での不正防止（解約後も使えてしまう等）にはならない。
   まずは最速で課金を始めるための現実的な実装であり、本格運用
   時はWebhookでの検証（サブスク解約・失敗の反映）を追加すべき。
   ========================================================= */

import { markSubscribed } from "./session";
import { STRIPE_SUBSCRIPTION_LINK } from "./billing-config";

const SESSION_ID_PATTERN = /^cs_(test|live)_[A-Za-z0-9]{16,}$/;

export function isBillingConfigured(): boolean {
  return (
    STRIPE_SUBSCRIPTION_LINK.startsWith("https://buy.stripe.com/") &&
    !STRIPE_SUBSCRIPTION_LINK.includes("YOUR_SUBSCRIPTION_LINK")
  );
}

// 決済リンクから戻ってきたときに解放を記録し、URLからパラメータを消す。ページ読み込み時に1度だけ呼ぶ。
export function handleReturnFromCheckout() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("paid") !== "1") return;
  const sessionId = params.get("session_id") || "";
  if (!SESSION_ID_PATTERN.test(sessionId)) return;

  markSubscribed();
  const url = new URL(window.location.href);
  url.searchParams.delete("paid");
  url.searchParams.delete("session_id");
  window.history.replaceState({}, "", url.toString());
}

export function openCheckout(): boolean {
  if (!isBillingConfigured()) return false;
  window.open(STRIPE_SUBSCRIPTION_LINK, "_blank", "noopener");
  return true;
}
