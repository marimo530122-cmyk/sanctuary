/* =========================================================
   利用時間の管理（無料3分・24時間で解除・月額500円サブスク）
   ---------------------------------------------------------
   ・無料枠は「3分間」。使い切ったら、24時間経過するまで
     再度「無料の3分間」は使えない（サブスク中は無制限）。
   ・実際の会話ログは一切サーバーに保存しない前提のため、
     この時間管理もすべて端末のlocalStorageで完結させる。
   ========================================================= */

const FREE_SECONDS = 3 * 60;
const RESET_HOURS = 24;
const SUB_RECHECK_HOURS = 12;

const USED_KEY = "sanctuary-free-seconds-used";
const WINDOW_START_KEY = "sanctuary-free-window-start";
const SUBSCRIBED_KEY = "sanctuary-subscribed";
const CUSTOMER_ID_KEY = "sanctuary-customer-id";
const SUB_CHECKED_AT_KEY = "sanctuary-sub-checked-at";

function now() {
  return Date.now();
}

// 24時間経っていたら、使用時間をリセットする
function ensureFreshWindow() {
  const start = Number(localStorage.getItem(WINDOW_START_KEY) || 0);
  if (!start || now() - start > RESET_HOURS * 3600 * 1000) {
    localStorage.setItem(WINDOW_START_KEY, String(now()));
    localStorage.setItem(USED_KEY, "0");
  }
}

export function isSubscribed(): boolean {
  try {
    return localStorage.getItem(SUBSCRIBED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markSubscribed() {
  try {
    localStorage.setItem(SUBSCRIBED_KEY, "1");
  } catch {
    /* noop */
  }
}

// 解約検知（Stripeへの問い合わせ）で「もう有効ではない」と分かったときに呼ぶ
export function clearSubscribed() {
  try {
    localStorage.removeItem(SUBSCRIBED_KEY);
  } catch {
    /* noop */
  }
}

export function getCustomerId(): string | null {
  try {
    return localStorage.getItem(CUSTOMER_ID_KEY);
  } catch {
    return null;
  }
}

export function setCustomerId(id: string) {
  try {
    localStorage.setItem(CUSTOMER_ID_KEY, id);
  } catch {
    /* noop */
  }
}

// 前回Stripeに解約状況を問い合わせてから十分な時間が経っているか
export function shouldRecheckSubscription(): boolean {
  try {
    const last = Number(localStorage.getItem(SUB_CHECKED_AT_KEY) || 0);
    return !last || now() - last > SUB_RECHECK_HOURS * 3600 * 1000;
  } catch {
    return true;
  }
}

export function markSubscriptionChecked() {
  try {
    localStorage.setItem(SUB_CHECKED_AT_KEY, String(now()));
  } catch {
    /* noop */
  }
}

export function getRemainingFreeSeconds(): number {
  try {
    ensureFreshWindow();
    const used = Number(localStorage.getItem(USED_KEY) || 0);
    return Math.max(0, FREE_SECONDS - used);
  } catch {
    return FREE_SECONDS;
  }
}

export function addUsedSeconds(seconds: number) {
  try {
    ensureFreshWindow();
    const used = Number(localStorage.getItem(USED_KEY) || 0);
    localStorage.setItem(USED_KEY, String(used + seconds));
  } catch {
    /* noop */
  }
}

export function getResetEta(): Date | null {
  try {
    const start = Number(localStorage.getItem(WINDOW_START_KEY) || 0);
    if (!start) return null;
    return new Date(start + RESET_HOURS * 3600 * 1000);
  } catch {
    return null;
  }
}

export function canChat(): boolean {
  return isSubscribed() || getRemainingFreeSeconds() > 0;
}
