/* =========================================================
   /api/tts — 高品質音声合成の中継（任意・OpenAI TTS）
   ---------------------------------------------------------
   ・OPENAI_API_KEYが設定されている場合だけ動作する「プレミアム」経路。
     未設定の場合は501を返し、クライアント側（lib/voice-engine.ts）は
     自動的にブラウザ標準のWeb Speech APIにフォールバックする
     （課金・追加設定なしでも従来通り動く）。
   ・返す音声データ（mp3のバイト列）をクライアント側でWeb Audio APIの
     AnalyserNodeに通すことで、初めて「実際の音量に基づく」リップ
     シンクが可能になる（ブラウザ標準のSpeechSynthesisでは波形を
     取得できないため、この経路がないと真のリップシンクは実現不可能）。
   ========================================================= */

import { NextRequest, NextResponse } from "next/server";

const MAX_TEXT_LENGTH = 600;

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 501 });
  }

  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.slice(0, MAX_TEXT_LENGTH).trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: text,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json({ error: "TTS provider error", detail: errText.slice(0, 300) }, { status: 502 });
    }

    const audio = await response.arrayBuffer();
    return new NextResponse(audio, {
      headers: { "content-type": "audio/mpeg" },
    });
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
