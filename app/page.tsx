"use client";

import { useEffect, useRef, useState } from "react";
import { AmbientEngine } from "@/lib/audio-engine";
import {
  addUsedSeconds,
  canChat,
  getRemainingFreeSeconds,
  isSubscribed,
} from "@/lib/session";
import { handleReturnFromCheckout, isBillingConfigured, openCheckout } from "@/lib/billing";

type ChatMessage = { role: "user" | "assistant"; content: string };
type Phase = "loading" | "nickname" | "chat";

const NICKNAME_KEY = "sanctuary-nickname";

// よりそいホットライン（24時間・無料）。本当に必要な人だけが辿り着けるよう、
// AIのセリフとしては一切言わせず、静かなUI要素としてのみ現れる。
const RESOURCE_LABEL = "→ もしもの時は";
const RESOURCE_TEXT = "よりそいホットライン　0120-279-338（24時間・無料）";

export default function Home() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [nickname, setNickname] = useState("");
  const [nicknameInput, setNicknameInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [isComposing, setIsComposing] = useState(false);

  const [ambiguousCount, setAmbiguousCount] = useState(0);
  const [explicitTriggered, setExplicitTriggered] = useState(false);
  const [resourceOpen, setResourceOpen] = useState(false);

  const [remainingSeconds, setRemainingSeconds] = useState(180);
  const [subscribed, setSubscribed] = useState(false);

  const engineRef = useRef<AmbientEngine | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const showResource = explicitTriggered || ambiguousCount >= 3;

  useEffect(() => {
    handleReturnFromCheckout();
    setSubscribed(isSubscribed());
    setRemainingSeconds(getRemainingFreeSeconds());
    const saved = typeof window !== "undefined" ? localStorage.getItem(NICKNAME_KEY) : null;
    if (saved) {
      setNickname(saved);
      setPhase("chat");
    } else {
      setPhase("nickname");
    }
    return () => {
      engineRef.current?.stop();
    };
  }, []);

  // チャット画面にいる間だけ、環境音を流す
  useEffect(() => {
    if (phase !== "chat") return;
    if (!engineRef.current) engineRef.current = new AmbientEngine();
    engineRef.current.start();
  }, [phase]);

  // 無料枠のタイマー（サブスク中はカウントしない）
  useEffect(() => {
    if (phase !== "chat" || subscribed) return;
    const interval = setInterval(() => {
      addUsedSeconds(1);
      setRemainingSeconds((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, subscribed]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function startSession() {
    const name = nicknameInput.trim() || "あなた";
    setNickname(name);
    try {
      localStorage.setItem(NICKNAME_KEY, name);
    } catch {
      /* noop */
    }
    setPhase("chat");
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;
    if (!subscribed && remainingSeconds <= 0) return;

    setInput("");
    setSending(true);
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, nickname, history: nextMessages.slice(0, -1) }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessages((m) => [...m, { role: "assistant", content: "……少し、うまく声が出せなかったみたい。もう一度、話しかけてみてくれる？" }]);
        return;
      }

      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      if (data.risk === "explicit") setExplicitTriggered(true);
      else if (data.risk === "ambiguous") setAmbiguousCount((c) => c + 1);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "……少し、うまく声が出せなかったみたい。もう一度、話しかけてみてくれる？" }]);
    } finally {
      setSending(false);
    }
  }

  if (phase === "loading") {
    return <div className="flex-1" />;
  }

  if (phase === "nickname") {
    return (
      <main className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="w-2 h-2 rounded-full bg-[#8b93a8] breathe mb-10" />
        <p className="text-sm text-[#9a97a0] mb-8 text-center leading-loose">
          ここでは、無理して話さなくていい。
          <br />
          呼んでほしい名前だけ、教えてください。
        </p>
        <input
          value={nicknameInput}
          onChange={(e) => setNicknameInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && startSession()}
          maxLength={20}
          placeholder="呼び名"
          className="bg-transparent border-b border-[#3a3942] text-center text-lg py-2 px-4 outline-none focus:border-[#6a6878] transition-colors w-56"
          autoFocus
        />
        <button
          onClick={startSession}
          className="mt-10 text-xs tracking-widest text-[#6a6878] hover:text-[#9a97a0] transition-colors"
        >
          はじめる
        </button>
      </main>
    );
  }

  const timeUp = !subscribed && remainingSeconds <= 0;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return (
    <main className="flex-1 flex flex-col max-w-lg w-full mx-auto px-5">
      <header className="pt-8 pb-4 flex items-center justify-between">
        <div className="w-1.5 h-1.5 rounded-full bg-[#8b93a8] breathe" />
        {!subscribed && (
          <span className="text-[10px] text-[#5a5862] tabular-nums">
            {timeUp ? "0:00" : `${minutes}:${seconds.toString().padStart(2, "0")}`}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto py-4 space-y-5">
        {messages.length === 0 && (
          <p className="text-sm text-[#9a97a0] leading-loose text-center mt-16">
            ……{nickname}さん。
            <br />
            ここに来るまで、今日一日どれだけのものを飲み込んできたんだろうね。
            <br />
            よくここまですり減らして頑張ってきたね。
            <br />
            ここは、もう無理して話さなくていい場所だよ。
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <p
              className={
                "inline-block text-sm leading-loose max-w-[85%] " +
                (m.role === "user" ? "text-[#c8c5cc]" : "text-[#e8e6e1]")
              }
            >
              {m.content}
            </p>
          </div>
        ))}
        {sending && <p className="text-xs text-[#5a5862]">……</p>}
        <div ref={bottomRef} />
      </div>

      {timeUp && (
        <div className="pb-3 text-center">
          <p className="text-xs text-[#9a97a0] leading-loose mb-2">
            今日はここまで。また明日、いつでも戻ってきていいから。
            <br />
            続きを話したいときは、こちらを。
          </p>
          {isBillingConfigured() ? (
            <button onClick={openCheckout} className="text-xs text-[#8b93a8] underline underline-offset-4">
              月額500円で、いつでも話せるようにする
            </button>
          ) : (
            <p className="text-[10px] text-[#5a5862]">（お試し中：課金設定は準備中です）</p>
          )}
        </div>
      )}

      <div className="pb-4">
        <div className="flex items-end gap-2 border-t border-[#1c1b21] pt-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onKeyDown={(e) => {
              // 日本語入力(IME)の変換確定Enterと送信Enterが競合しないようにする
              if (e.key === "Enter" && !e.shiftKey && !isComposing && !e.nativeEvent.isComposing) {
                e.preventDefault();
                sendMessage();
              }
            }}
            disabled={timeUp || sending}
            rows={1}
            placeholder={timeUp ? "" : "……"}
            className="flex-1 bg-transparent resize-none outline-none text-sm py-2 disabled:opacity-40"
          />
          <button
            onClick={sendMessage}
            disabled={timeUp || sending || !input.trim()}
            className="text-xs text-[#6a6878] hover:text-[#9a97a0] disabled:opacity-30 transition-colors py-2"
          >
            送る
          </button>
        </div>

        {showResource && (
          <div className="mt-3 text-right">
            {resourceOpen ? (
              <p className="text-[10px] text-[#7a7882]">{RESOURCE_TEXT}</p>
            ) : (
              <button
                onClick={() => setResourceOpen(true)}
                className="text-[10px] text-[#4a4852] hover:text-[#7a7882] transition-colors"
              >
                {RESOURCE_LABEL}
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
