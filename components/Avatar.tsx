"use client";

/* =========================================================
   Avatar — フルスクリーンの寄り添いアバター（SVG手続き描画）
   ---------------------------------------------------------
   ・外部の画像/動画素材は使わず、SVGで軽量に描く（Vercelへの
     デプロイに追加アセット不要、実在人物に似せる懸念もない）。
   ・正直な見立て: 手描きSVGでは写真的なリアリズムは出せない。
     代わりに、瞳の視線ドリフト・瞬き・眉のわずかな動き・呼吸・
     発話に連動した口の動きを重ねることで「静止画ではなく生きて
     いる感じ」を狙う方向性にした（要件定義書 セクション7参照）。
   ・口の開き具合・視線・瞬きは毎フレームSVG属性を直接書き換えて
     動かす（React state経由だと再レンダーが重くなるため）。
   ========================================================= */

import { useEffect, useRef } from "react";
import type { VoiceEngine } from "@/lib/voice-engine";
import type { AmbientEngine } from "@/lib/audio-engine";

export type Species = "dog" | "cat" | "bear" | "man" | "woman";

export const SPECIES_LABEL: Record<Species, string> = {
  dog: "いぬ",
  cat: "ねこ",
  bear: "くま",
  man: "男性",
  woman: "女性",
};

type SpeciesConfig = {
  headFill: string;
  topperFill: string;
  cheekFill: string;
  mouthFill: string;
  hasTongue: boolean;
  noseStyle: "snout" | "small";
};

const SPECIES_CONFIG: Record<Species, SpeciesConfig> = {
  dog: { headFill: "#c9a877", topperFill: "#a9865c", cheekFill: "#e8a0a0", mouthFill: "#4a2e2e", hasTongue: true, noseStyle: "snout" },
  cat: { headFill: "#9a9aa8", topperFill: "#7d7d8c", cheekFill: "#e8a0a0", mouthFill: "#4a2e2e", hasTongue: true, noseStyle: "snout" },
  bear: { headFill: "#b58a5c", topperFill: "#8f6a42", cheekFill: "#e8a0a0", mouthFill: "#4a2e2e", hasTongue: true, noseStyle: "snout" },
  man: { headFill: "#e0b08c", topperFill: "#3a3228", cheekFill: "#e8a0a0", mouthFill: "#8a4a4a", hasTongue: false, noseStyle: "small" },
  woman: { headFill: "#e8bfa0", topperFill: "#5a3826", cheekFill: "#f0a8b0", mouthFill: "#9a4a5a", hasTongue: false, noseStyle: "small" },
};

function Topper({ species, fill }: { species: Species; fill: string }) {
  switch (species) {
    case "dog":
      return (
        <>
          <ellipse cx="118" cy="165" rx="26" ry="52" fill={fill} transform="rotate(-18 118 165)" />
          <ellipse cx="282" cy="165" rx="26" ry="52" fill={fill} transform="rotate(18 282 165)" />
        </>
      );
    case "cat":
      return (
        <>
          <path d="M 110 140 L 90 70 L 155 118 Z" fill={fill} />
          <path d="M 290 140 L 310 70 L 245 118 Z" fill={fill} />
        </>
      );
    case "bear":
      return (
        <>
          <circle cx="112" cy="128" r="30" fill={fill} />
          <circle cx="288" cy="128" r="30" fill={fill} />
        </>
      );
    case "man":
      return (
        <path
          d="M 84 210 C 78 120 130 76 200 76 C 270 76 322 120 316 210 C 300 165 268 150 200 150 C 132 150 100 165 84 210 Z"
          fill={fill}
        />
      );
    case "woman":
      return (
        <path
          d="M 80 230 C 72 260 74 320 90 360 C 96 320 100 280 104 250 C 76 130 130 70 200 70 C 270 70 324 130 296 250 C 300 280 304 320 310 360 C 326 320 328 260 320 230 C 330 130 270 62 200 62 C 130 62 70 130 80 230 Z"
          fill={fill}
        />
      );
  }
}

// 簡易ビゼーム(母音の口形)morph: openness(口の開き)とwidth(0=お/う寄りの
// 丸い口、1=い/え寄りの横に広い口)から、単なる楕円の拡大縮小ではなく
// 母音ごとに異なる口の輪郭をベジェ曲線で生成する（lib/voice-engine.ts参照）
function mouthPath(cx: number, cy: number, openness: number, width: number): string {
  const rx = 14 + width * 16; // 14(丸い)〜30(横に広い)
  const ry = 3 + openness * 25;
  const curl = (0.5 - width) * 5; // 丸い口ほど、口角がわずかに上がって見えるように
  const left = cx - rx;
  const right = cx + rx;
  const top = cy - ry - curl;
  const bottom = cy + ry - curl;
  return `M ${left} ${cy - curl} C ${left} ${top}, ${right} ${top}, ${right} ${cy - curl} C ${right} ${bottom}, ${left} ${bottom}, ${left} ${cy - curl} Z`;
}

export function Avatar({
  species,
  voiceRef,
  ambientRef,
}: {
  species: Species;
  voiceRef: React.RefObject<VoiceEngine | null>;
  ambientRef: React.RefObject<AmbientEngine | null>;
}) {
  const mouthRef = useRef<SVGPathElement | null>(null);
  const tongueRef = useRef<SVGEllipseElement | null>(null);
  const chestRef = useRef<SVGEllipseElement | null>(null);
  const glowRef = useRef<SVGCircleElement | null>(null);
  const pupilLRef = useRef<SVGCircleElement | null>(null);
  const pupilRRef = useRef<SVGCircleElement | null>(null);
  const browLRef = useRef<SVGPathElement | null>(null);
  const browRRef = useRef<SVGPathElement | null>(null);

  useEffect(() => {
    let raf: number;
    const tick = (t: number) => {
      const speaking = voiceRef.current?.getMouthOpenness() ?? 0;
      const breath = ambientRef.current?.getBreathLevel() ?? 0;
      // 発話中はしっかり口が動く。発話していないときは、環境音のハミングに
      // 合わせてごくわずかに口・胸元が動く程度に抑える
      const openness = Math.max(speaking, breath * 0.16);
      // 発話していないとき(ハミング中)は中立(0.5=丸くも広くもない)の口形にする
      const width = speaking > 0.03 ? voiceRef.current?.getMouthWidth() ?? 0.5 : 0.5;

      if (mouthRef.current) mouthRef.current.setAttribute("d", mouthPath(200, 278, openness, width));
      if (tongueRef.current) {
        const tongueOpacity = openness > 0.45 ? Math.min(1, (openness - 0.45) * 2) : 0;
        tongueRef.current.setAttribute("opacity", String(tongueOpacity));
      }
      if (chestRef.current) chestRef.current.setAttribute("ry", String(46 + breath * 4));
      if (glowRef.current) glowRef.current.setAttribute("opacity", String(0.12 + breath * 0.08));

      // 視線のゆっくりしたドリフト（生きている感じを出すための微細な揺らぎ）
      const sec = t / 1000;
      const gazeX = Math.sin(sec * 0.35) * 2.6 + Math.sin(sec * 0.11) * 1.2;
      const gazeY = Math.cos(sec * 0.27) * 1.6;
      if (pupilLRef.current) pupilLRef.current.setAttribute("transform", `translate(${gazeX} ${gazeY})`);
      if (pupilRRef.current) pupilRRef.current.setAttribute("transform", `translate(${gazeX} ${gazeY})`);

      // 発話に合わせて眉がごくわずかに持ち上がる（表情の変化）
      const browLift = -openness * 3;
      if (browLRef.current) browLRef.current.setAttribute("transform", `translate(0 ${browLift})`);
      if (browRRef.current) browRRef.current.setAttribute("transform", `translate(0 ${browLift})`);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [voiceRef, ambientRef]);

  const cfg = SPECIES_CONFIG[species];

  return (
    <div className="fixed inset-0 -z-10 flex items-center justify-center overflow-hidden">
      <svg
        viewBox="0 0 400 460"
        className="h-full w-full max-w-2xl"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="avatarBgGlow" cx="50%" cy="38%" r="65%">
            <stop offset="0%" stopColor="#241c18" />
            <stop offset="100%" stopColor="#07070a" />
          </radialGradient>
        </defs>
        <rect width="400" height="460" fill="url(#avatarBgGlow)" />
        <circle ref={glowRef} cx="200" cy="210" r="150" fill="#c99a6e" opacity="0.12" />

        {/* 胸元（呼吸・ハミングで揺れる） */}
        <ellipse ref={chestRef} cx="200" cy="400" rx="70" ry="46" fill={cfg.topperFill} opacity="0.45" />

        {/* 耳・髪（種類ごとに切り替わる） */}
        <Topper species={species} fill={cfg.topperFill} />

        {/* 頭 */}
        <circle cx="200" cy="220" r="118" fill={cfg.headFill} />

        {/* 頬 */}
        <circle cx="140" cy="255" r="16" fill={cfg.cheekFill} opacity="0.3" />
        <circle cx="260" cy="255" r="16" fill={cfg.cheekFill} opacity="0.3" />

        {/* 眉（発話にあわせてわずかに動く） */}
        <path ref={browLRef} d="M 146 176 Q 160 168 176 176" stroke="#3a352e" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.55" />
        <path ref={browRRef} d="M 224 176 Q 240 168 254 176" stroke="#3a352e" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.55" />

        {/* 目（白目 + 視線ドリフトする瞳 + 瞬き） */}
        <g className="avatar-blink" style={{ transformBox: "view-box", transformOrigin: "160px 200px" }}>
          <ellipse cx="160" cy="200" rx="12" ry="14" fill="#f5f0e8" />
          <circle ref={pupilLRef} cx="160" cy="200" r="6.5" fill="#2a2820" />
        </g>
        <g className="avatar-blink" style={{ transformBox: "view-box", transformOrigin: "240px 200px" }}>
          <ellipse cx="240" cy="200" rx="12" ry="14" fill="#f5f0e8" />
          <circle ref={pupilRRef} cx="240" cy="200" r="6.5" fill="#2a2820" />
        </g>

        {/* 鼻 */}
        {cfg.noseStyle === "snout" ? (
          <ellipse cx="200" cy="248" rx="12" ry="9" fill="#3a352e" />
        ) : (
          <ellipse cx="200" cy="248" rx="4" ry="6" fill={cfg.topperFill} opacity="0.4" />
        )}

        {/* 口（音声の音量・周波数分布に連動して開閉+母音の形が変わる簡易ビゼーム） */}
        <path ref={mouthRef} d={mouthPath(200, 278, 0, 0.5)} fill={cfg.mouthFill} />
        {cfg.hasTongue && <ellipse ref={tongueRef} cx="200" cy="286" rx="14" ry="9" fill="#c96a7a" opacity="0" />}
      </svg>
    </div>
  );
}
