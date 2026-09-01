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

const USED_KEY = "sanctuary-free-seconds-used";
const WINDOW_START_KEY = "sanctuary-free-window-start";
const SUBSCRIBED_KEY = "sanctuary-subscribed";

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
