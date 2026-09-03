/* =========================================================
   💎 月額課金（Stripe決済リンク + サーバー側での検証）
   ---------------------------------------------------------
   決済完了後のリダイレクト（?paid=1&session_id=...）を検知したら、
   まずサーバー（/api/subscription/verify）にStripeの実際の状態を
   確認してから、端末のlocalStorageに「サブスク中」を記録する。
   その後もチャット画面を開くたびに（既定12時間おき）、
   /api/subscription/status で「今も本当に有効か」を問い合わせ直し、
   解約されていれば端末側の解放を取り消す（解約検知）。

   ⚠️ 正直な限界: STRIPE_SECRET_KEYがサーバー側で未設定の間は、
   従来通り「リダイレクトの形式だけを信じる」簡易動作にフォールバック
   する（batuge-muのbilling.jsと同じ方式）。この機能の導入前から
   すでに解放されていた端末は customerId を持たないため、解約検知の
   対象にはならない（再度チェックアウトを通れば対象になる）。
   ========================================================= */

import {
  markSubscribed,
  clearSubscribed,
  getCustomerId,
  setCustomerId,
  shouldRecheckSubscription,
  markSubscriptionChecked,
} from "./session";
import { STRIPE_SUBSCRIPTION_LINK } from "./billing-config";
import { SESSION_ID_PATTERN } from "./stripe-shared";

export function isBillingConfigured(): boolean {
  return (
    STRIPE_SUBSCRIPTION_LINK.startsWith("https://buy.stripe.com/") &&
    !STRIPE_SUBSCRIPTION_LINK.includes("YOUR_SUBSCRIPTION_LINK")
  );
}

// 決済リンクから戻ってきたときに呼ぶ（ページ読み込み時に1度だけ、await必須）。
// サーバーでの確認が終わるまで解放を確定させない
export async function handleReturnFromCheckout() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("paid") !== "1") return;
  const sessionId = params.get("session_id") || "";

  const url = new URL(window.location.href);
  url.searchParams.delete("paid");
  url.searchParams.delete("session_id");
  window.history.replaceState({}, "", url.toString());

  if (!SESSION_ID_PATTERN.test(sessionId)) return;

  try {
    const res = await fetch(`/api/subscription/verify?session_id=${encodeURIComponent(sessionId)}`);
    if (!res.ok) {
      // サーバーに問い合わせられなかった（一時的な障害等）。支払った人を
      // 締め出さないよう、従来通りリダイレクトそのものを信じて解放する
      markSubscribed();
      return;
    }
    const data = await res.json();
    if (data.verified === false) {
      // STRIPE_SECRET_KEY未設定 — 従来の簡易方式のまま
      markSubscribed();
      return;
    }
    if (data.active && data.customerId) {
      markSubscribed();
      setCustomerId(data.customerId);
      markSubscriptionChecked();
    }
    // active:false の場合は解放しない（Stripe側が「有効でない」と答えた）
  } catch {
    markSubscribed();
  }
}

// チャット画面を開くたびに（頻度は絞って）呼ぶ。解約されていたら端末側の解放を取り消す
export async function refreshSubscriptionStatus() {
  if (typeof window === "undefined") return;
  const customerId = getCustomerId();
  if (!customerId || !shouldRecheckSubscription()) return;

  try {
    const res = await fetch(`/api/subscription/status?customerId=${encodeURIComponent(customerId)}`);
    if (!res.ok) return;
    const data = await res.json();
    markSubscriptionChecked();
    if (data.active === false) clearSubscribed();
  } catch {
    /* 問い合わせに失敗した場合は、解放は維持したまま次回また試す */
  }
}

export function openCheckout(): boolean {
  if (!isBillingConfigured()) return false;
  window.open(STRIPE_SUBSCRIPTION_LINK, "_blank", "noopener");
  return true;
}
