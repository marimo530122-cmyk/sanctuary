/* =========================================================
   /api/chat — Sanctuaryの対話エンジン本体（Next.jsサーバー側）
   ---------------------------------------------------------
   ・ブラウザから直接Anthropic APIを呼ぶと秘密鍵が盗まれるため、
     このAPIルートがサーバー側で鍵(ANTHROPIC_API_KEY)を持って中継する
   ・ANTHROPIC_API_KEYは、Vercelのプロジェクト設定 →
     Environment Variables に登録すること（このファイルには書かない）
   ・応答の最後にある [[RISK:...]] 判定マーカーはここで取り除き、
     ユーザーには絶対に見せない
   ========================================================= */

import { NextRequest, NextResponse } from "next/server";
import { SYSTEM_PROMPT, extractRisk } from "@/lib/system-prompt";

const MAX_MESSAGE_LENGTH = 600;
const MAX_HISTORY_TURNS = 12;
const MAX_TOKENS = 400;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured on the server" }, { status: 500 });
  }

  let body: { message?: unknown; history?: unknown; nickname?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.slice(0, MAX_MESSAGE_LENGTH).trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  const nickname = typeof body.nickname === "string" ? body.nickname.slice(0, 30) : "あなた";

  const historyIn = Array.isArray(body.history) ? body.history : [];
  const history = historyIn
    .filter(
      (m): m is { role: string; content: string } =>
        !!m &&
        typeof m === "object" &&
        (m as { role?: unknown }).role !== undefined &&
        ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant") &&
        typeof (m as { content?: unknown }).content === "string"
    )
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }));

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: MAX_TOKENS,
        system: `${SYSTEM_PROMPT}\n\n（このユーザーのニックネームは「${nickname}」です。この名前だけで呼びかけてください。）`,
        messages: [...history, { role: "user", content: message }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json({ error: "AI provider error", detail: errText.slice(0, 300) }, { status: 502 });
    }

    const data = await response.json();
    const rawText =
      (Array.isArray(data.content) ? data.content.map((b: { text?: string }) => b.text || "").join("") : "") || "";
    const { text, risk } = extractRisk(rawText || "……");

    return NextResponse.json({ reply: text || "……", risk });
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
