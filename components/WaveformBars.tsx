"use client";

import { useEffect, useRef } from "react";
import type { VoiceEngine } from "@/lib/voice-engine";

const BAR_COUNT = 5;

export function WaveformBars({ voiceRef }: { voiceRef: React.RefObject<VoiceEngine | null> }) {
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let raf: number;
    const tick = () => {
      const levels = voiceRef.current?.getWaveformLevels(BAR_COUNT) ?? new Array(BAR_COUNT).fill(0);
      levels.forEach((level, i) => {
        const el = barRefs.current[i];
        if (el) el.style.transform = `scaleY(${0.15 + level * 0.85})`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [voiceRef]);

  return (
    <div className="flex items-center gap-[3px] h-3.5">
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <div
          key={i}
          ref={(el) => {
            barRefs.current[i] = el;
          }}
          className="w-[2.5px] h-full rounded-full bg-[#8b93a8] origin-center"
          style={{ transform: "scaleY(0.15)" }}
        />
      ))}
    </div>
  );
}
