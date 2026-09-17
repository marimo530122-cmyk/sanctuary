/* =========================================================
   VoiceEngine — 発話 + リップシンク（プレミアム音声 / 無料フォールバック）
   ---------------------------------------------------------
   ・2つの発話経路を持つ:
     ①プレミアム（/api/tts、OpenAI TTS。OPENAI_API_KEY設定時のみ）
       → 実際の音声データをWeb Audio APIのAnalyserNodeに通し、
         本物の音量（RMS振幅）に基づくリアルタイムのリップシンクを行う。
     ②無料フォールバック（ブラウザ標準のWeb Speech API）
       → SpeechSynthesisは合成波形をWeb Audio APIに渡せない仕様のため、
         `boundary`イベント（発話中の単語の区切り）ごとに、その単語の
         長さに応じた「素早く開いて自然に閉じる」エンベロープを生成し、
         発話タイミングに連動した疑似リップシンクを行う。
   ・どちらの経路でも、音声はブラウザ内で完結し、会話ログとしては
     どこにも保存されない（プレミアム経路のテキストはOpenAIのAPIには
     渡るが、それ以外の用途では使われない）。
   ・初回のプレミアム経路の呼び出しが失敗（未設定含む）した場合、その
     セッション内は以降フォールバックのみを使う（無駄な失敗リクエストを
     繰り返さないため）。
   ========================================================= */

const VOICE_ENABLED_KEY = "sanctuary-voice-enabled";

export class VoiceEngine {
  private mouthOpenness = 0;
  private targetOpenness = 0;
  // 口の「開き」(openness)に加えて、母音の広がり方(width: 0=お/う寄りの
  // 丸い口、1=い/え寄りの横に広い口)を別軸として持つことで、単なる
  // 楕円の拡大縮小ではなく簡易的なビゼーム(母音の口形)morphを行う。
  private mouthWidth = 0.5;
  private targetWidth = 0.5;
  private rafId: number | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private lastBoundaryAt = 0;
  private voice: SpeechSynthesisVoice | null = null;
  private speaking = false;

  // プレミアム経路（Web Audio API）
  private premiumAvailable: boolean | null = null; // null=未確認, true=使える, false=使えない
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Uint8Array<ArrayBuffer> | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private activeSource: AudioBufferSourceNode | null = null;
  private usingPremium = false;

  constructor() {
    if (!this.isSupported()) return;
    this.loadVoice();
    window.speechSynthesis.addEventListener("voiceschanged", () => this.loadVoice());
  }

  private loadVoice() {
    const voices = window.speechSynthesis.getVoices();
    this.voice =
      voices.find((v) => v.lang === "ja-JP" && /female|女性/i.test(v.name)) ||
      voices.find((v) => v.lang === "ja-JP") ||
      voices.find((v) => v.lang.startsWith("ja")) ||
      null;
  }

  isSupported() {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  isEnabled(): boolean {
    try {
      const v = localStorage.getItem(VOICE_ENABLED_KEY);
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  }

  setEnabled(enabled: boolean) {
    try {
      localStorage.setItem(VOICE_ENABLED_KEY, enabled ? "1" : "0");
    } catch {
      /* noop */
    }
    if (!enabled) this.stop();
  }

  isSpeaking() {
    return this.speaking;
  }

  isUsingPremiumVoice() {
    return this.usingPremium;
  }

  async speak(text: string) {
    if (!this.isEnabled() || !text.trim()) return;
    this.stop();

    if (this.premiumAvailable !== false) {
      const ok = await this.speakPremium(text);
      if (ok) return;
      this.premiumAvailable = false;
    }
    this.speakFallback(text);
  }

  // ---------------- プレミアム経路（実音声 + 本物の振幅解析） ----------------

  private async speakPremium(text: string): Promise<boolean> {
    if (typeof window === "undefined") return false;
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return false;
      const bytes = await res.arrayBuffer();

      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!this.audioCtx) this.audioCtx = new Ctor();
      if (this.audioCtx.state === "suspended") await this.audioCtx.resume();

      const audioBuffer = await this.audioCtx.decodeAudioData(bytes.slice(0));

      const source = this.audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      analyser.connect(this.audioCtx.destination);

      this.analyser = analyser;
      this.analyserData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      this.freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      this.activeSource = source;
      this.speaking = true;
      this.usingPremium = true;
      this.premiumAvailable = true;

      source.onended = () => this.finishSpeaking();
      source.start();
      this.startPremiumLoop();
      return true;
    } catch {
      return false;
    }
  }

  private startPremiumLoop() {
    if (this.rafId) return;
    const tick = () => {
      if (!this.analyser || !this.analyserData || !this.freqData) return;
      this.analyser.getByteTimeDomainData(this.analyserData);
      let sum = 0;
      for (let i = 0; i < this.analyserData.length; i++) {
        const v = (this.analyserData[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / this.analyserData.length);
      this.mouthOpenness = Math.min(1, rms * 3.4);

      // 簡易ビゼーム推定: 周波数分布の「重心」が低い(低域中心)ほど
      // お・う寄りの丸い口、高い(高域寄り)ほどい・え寄りの横に広い口、
      // として mouthWidth に反映する（厳密な音素認識ではなく、あくまで
      // 見た目のバリエーションを増やすための近似）
      this.analyser.getByteFrequencyData(this.freqData);
      let weighted = 0;
      let total = 0;
      for (let i = 0; i < this.freqData.length; i++) {
        weighted += i * this.freqData[i];
        total += this.freqData[i];
      }
      if (total > 20) {
        const centroid = weighted / total / this.freqData.length; // 0..1
        this.targetWidth = Math.min(1, Math.max(0, centroid * 2.2));
      }
      this.mouthWidth += (this.targetWidth - this.mouthWidth) * 0.25;

      if (this.speaking) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.mouthOpenness = 0;
        this.rafId = null;
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  // 発話中の音の強さを、count本のバー（0〜1）に分解する。
  // プレミアム経路が使えるときは実際の周波数分布から、それ以外は
  // 口の開き具合から擬似的に生成する（アバター下部の波形演出用）
  getWaveformLevels(count: number): number[] {
    if (this.usingPremium && this.analyser) {
      const freqData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      this.analyser.getByteFrequencyData(freqData);
      const bucket = Math.max(1, Math.floor(freqData.length / count));
      const levels: number[] = [];
      for (let i = 0; i < count; i++) {
        let sum = 0;
        for (let j = 0; j < bucket; j++) sum += freqData[i * bucket + j] || 0;
        levels.push(Math.min(1, sum / bucket / 255));
      }
      return levels;
    }
    const base = this.mouthOpenness;
    const now = performance.now();
    return Array.from({ length: count }, (_, i) => {
      const wave = (Math.sin(now / 140 + i * 1.3) + 1) / 2;
      return Math.min(1, base * (0.5 + wave * 0.5));
    });
  }

  // ---------------- 無料フォールバック（Web Speech API） ----------------

  private speakFallback(text: string) {
    if (!this.isSupported()) return;

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ja-JP";
    if (this.voice) utter.voice = this.voice;
    utter.rate = 0.92;
    utter.pitch = 1.0;
    utter.volume = 0.85;

    utter.onboundary = (e) => {
      this.lastBoundaryAt = performance.now();
      const charLen = (e as SpeechSynthesisEvent & { charLength?: number }).charLength || 4;
      this.targetOpenness = Math.min(1, 0.4 + charLen * 0.08);
    };
    utter.onstart = () => {
      this.speaking = true;
      this.usingPremium = false;
      this.lastBoundaryAt = 0;
      this.startFallbackLoop();
      this.startFallbackTimer();
    };
    utter.onend = () => this.finishSpeaking();
    utter.onerror = () => this.finishSpeaking();

    window.speechSynthesis.speak(utter);
  }

  // `boundary`イベントに対応していないブラウザ向けの簡易フォールバック
  private startFallbackTimer() {
    if (this.fallbackTimer) return;
    this.fallbackTimer = setInterval(() => {
      if (!this.speaking) return;
      const since = performance.now() - this.lastBoundaryAt;
      if (this.lastBoundaryAt === 0 || since > 500) {
        this.targetOpenness = 0.45 + Math.random() * 0.3;
      }
    }, 220);
  }

  private startFallbackLoop() {
    if (this.rafId) return;
    const tick = () => {
      const rate = this.mouthOpenness < this.targetOpenness ? 0.55 : 0.12;
      this.mouthOpenness += (this.targetOpenness - this.mouthOpenness) * rate;
      this.targetOpenness *= 0.85;

      // フォールバック経路は実際の音声波形を解析できないため、口の広がり
      // (mouthWidth)は実データではなく、発話中だけゆっくり往復させる疑似
      // 演出にとどめる（本物の母音判定ではないことに注意。voice-engine.ts
      // 冒頭のコメント参照）
      if (this.speaking) {
        this.targetWidth = 0.35 + (Math.sin(performance.now() / 170) + 1) * 0.15;
      } else {
        this.targetWidth = 0.5;
      }
      this.mouthWidth += (this.targetWidth - this.mouthWidth) * 0.15;

      if (this.mouthOpenness < 0.02 && !this.speaking) {
        this.mouthOpenness = 0;
        this.rafId = null;
        return;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  // ---------------- 共通 ----------------

  private finishSpeaking() {
    this.speaking = false;
    this.targetOpenness = 0;
    this.targetWidth = 0.5;
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
    this.fallbackTimer = null;
    this.activeSource = null;
    this.analyser = null;
    this.analyserData = null;
  }

  stop() {
    if (this.isSupported()) window.speechSynthesis.cancel();
    if (this.activeSource) {
      try {
        this.activeSource.stop();
      } catch {
        /* already stopped */
      }
    }
    this.finishSpeaking();
  }

  getMouthOpenness() {
    return this.mouthOpenness;
  }

  // 0=お・う寄りの丸い口、1=い・え寄りの横に広い口（セクション「共通」参照）
  getMouthWidth() {
    return this.mouthWidth;
  }
}
