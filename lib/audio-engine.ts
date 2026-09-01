/* =========================================================
   非言語の音響エンジン（アンビエントBGM + 気配への呼応）
   ---------------------------------------------------------
   ・正直な設計方針: 「ユーザーの息づかいにAIがリアルタイムで
     美しくハモる」は、現状のブラウザ技術（WebGPU/WASM）では
     期待される品質での実現が難しいと判断した。
     代わりに、Web Audioでコード進行を持つアンビエントパッドを
     生成し、マイクで拾った「声・息の気配（音量）」に応じて
     音の重なり・明るさをゆっくり変化させる、より現実的な
     「気配への呼応」から始める。
   ・マイクの生音声は一切録音・送信しない。音量（振幅）だけを
     ブラウザ内でその場で見るだけ。
   ========================================================= */

// 静かな、解決しないコード進行（Cmaj7 - Am7 - Fmaj7 - Em7 のループ、テンポは非常にゆっくり）
const CHORD_PROGRESSION: number[][] = [
  [261.63, 329.63, 392.0, 493.88], // Cmaj7
  [220.0, 261.63, 329.63, 392.0], // Am7
  [174.61, 220.0, 261.63, 349.23], // Fmaj7
  [164.81, 196.0, 246.94, 329.63], // Em7
];
const CHORD_DURATION_SEC = 8;

export class AmbientEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private oscillators: OscillatorNode[] = [];
  private chordGains: GainNode[] = [];
  private chordIndex = 0;
  private chordTimer: ReturnType<typeof setInterval> | null = null;

  private micStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private micData: Uint8Array<ArrayBuffer> | null = null;
  private presenceLevel = 0;
  private rafId: number | null = null;

  isRunning() {
    return !!this.ctx;
  }

  async start() {
    if (this.ctx) return;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.0;
    this.masterGain.connect(this.ctx.destination);
    // 立ち上がりも呼吸のようにゆっくり
    this.masterGain.gain.linearRampToValueAtTime(0.06, this.ctx.currentTime + 4);

    this.playChord(this.chordIndex);
    this.chordTimer = setInterval(() => {
      this.chordIndex = (this.chordIndex + 1) % CHORD_PROGRESSION.length;
      this.playChord(this.chordIndex);
    }, CHORD_DURATION_SEC * 1000);
  }

  private playChord(index: number) {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const freqs = CHORD_PROGRESSION[index];

    // 前のコードをゆっくりフェードアウト
    this.oscillators.forEach((osc, i) => {
      const g = this.chordGains[i];
      if (g) g.gain.linearRampToValueAtTime(0, now + CHORD_DURATION_SEC * 0.6);
      osc.stop(now + CHORD_DURATION_SEC * 0.7);
    });
    this.oscillators = [];
    this.chordGains = [];

    freqs.forEach((freq) => {
      const osc = this.ctx!.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = this.ctx!.createGain();
      gain.gain.value = 0;
      gain.gain.linearRampToValueAtTime(1 / freqs.length, now + CHORD_DURATION_SEC * 0.5);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now);
      this.oscillators.push(osc);
      this.chordGains.push(gain);
    });
  }

  // マイクの「気配（音量）」を検知して、音の明るさをわずかに揺らす（任意・許可された場合のみ）
  async enablePresenceSensing() {
    if (this.micStream || !this.ctx) return false;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return false;
    }
    const source = this.ctx.createMediaStreamSource(this.micStream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.8;
    source.connect(this.analyser);
    this.micData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.tickPresence();
    return true;
  }

  private tickPresence = () => {
    if (!this.analyser || !this.micData) return;
    this.analyser.getByteTimeDomainData(this.micData);
    let sum = 0;
    for (let i = 0; i < this.micData.length; i++) {
      const v = (this.micData[i] - 128) / 128;
      sum += v * v;
    }
    this.presenceLevel = Math.sqrt(sum / this.micData.length);
    if (this.masterGain && this.ctx) {
      // 気配があるときだけ、ごくわずかに音を豊かにする（派手な反応にはしない）
      const base = 0.06;
      const target = base + Math.min(this.presenceLevel * 0.15, 0.03);
      this.masterGain.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 0.6);
    }
    this.rafId = requestAnimationFrame(this.tickPresence);
  };

  getPresenceLevel() {
    return this.presenceLevel;
  }

  stopPresenceSensing() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    this.analyser = null;
  }

  stop() {
    this.stopPresenceSensing();
    if (this.chordTimer) clearInterval(this.chordTimer);
    this.chordTimer = null;
    const now = this.ctx?.currentTime ?? 0;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.linearRampToValueAtTime(0, now + 2);
    }
    setTimeout(() => {
      this.oscillators.forEach((o) => {
        try { o.stop(); } catch { /* already stopped */ }
      });
      this.ctx?.close();
      this.ctx = null;
    }, 2200);
  }
}
