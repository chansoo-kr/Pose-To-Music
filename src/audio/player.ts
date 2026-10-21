export interface PlayOptions {
  /** 재생 시작 전 대기 시간(초). 이 동안 songTime()은 음수 */
  leadIn?: number;
  /** 곡의 이 시점(초)에서 페이드아웃하며 정지 */
  endAt?: number;
  onEnded?: () => void;
}

/**
 * Web Audio 기반 재생기. 게임의 모든 타이밍은 songTime()을 기준으로 한다.
 */
export class AudioEngine {
  readonly ctx = new AudioContext({ latencyHint: "interactive" });
  private master = this.ctx.createGain();
  private source: AudioBufferSourceNode | null = null;
  private songGain: GainNode | null = null;
  private startAt = 0;

  constructor() {
    this.master.connect(this.ctx.destination);
  }

  get playing() {
    return this.source !== null;
  }

  unlock() {
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private get outputLatency() {
    return this.ctx.outputLatency || this.ctx.baseLatency || 0;
  }

  /** 곡 기준 현재 시각(초). 출력 지연을 빼서 "실제로 들리는" 시점에 맞춘다 */
  songTime() {
    return this.ctx.currentTime - this.startAt - this.outputLatency;
  }

  play(buffer: AudioBuffer, opts: PlayOptions = {}) {
    this.stop();
    const leadIn = opts.leadIn ?? 0;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    src.connect(gain).connect(this.master);

    this.startAt = this.ctx.currentTime + leadIn + 0.05;
    src.start(this.startAt);
    const end = Math.min(opts.endAt ?? buffer.duration, buffer.duration);
    if (end < buffer.duration) {
      const fade = 1.5;
      gain.gain.setValueAtTime(1, this.startAt + end - fade);
      gain.gain.linearRampToValueAtTime(0, this.startAt + end);
      src.stop(this.startAt + end);
    }
    src.onended = () => {
      if (this.source === src) {
        this.source = null;
        opts.onEnded?.();
      }
    };
    this.source = src;
    this.songGain = gain;
  }

  stop() {
    const src = this.source;
    this.source = null;
    if (src) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        /* 이미 정지됨 */
      }
      src.disconnect();
    }
    this.songGain?.disconnect();
    this.songGain = null;
  }

  /** songTime 기준 시각에 짧은 클릭음 */
  clickAt(songTime: number, freq = 1200, volume = 0.25) {
    const t = Math.max(this.ctx.currentTime, this.startAt + songTime);
    this.beep(t, freq, volume, 0.06);
  }

  /** 즉시 효과음 */
  sfx(kind: "shutter" | "perfect" | "good" | "miss" | "select" | "tick") {
    const t = this.ctx.currentTime;
    switch (kind) {
      case "shutter":
        this.noiseBurst(t, 0.08, 0.35);
        this.beep(t, 1800, 0.15, 0.05);
        break;
      case "perfect":
        this.beep(t, 1320, 0.12, 0.08);
        this.beep(t + 0.05, 1760, 0.12, 0.1);
        break;
      case "good":
        this.beep(t, 990, 0.1, 0.08);
        break;
      case "miss":
        this.beep(t, 220, 0.12, 0.12, "sawtooth");
        break;
      case "select":
        this.beep(t, 880, 0.12, 0.05);
        break;
      case "tick":
        this.beep(t, 2000, 0.06, 0.02);
        break;
    }
  }

  private beep(t: number, freq: number, volume: number, dur: number, type: OscillatorType = "sine") {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(t: number, dur: number, volume: number) {
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.master);
    src.start(t);
  }

  async decode(data: ArrayBuffer) {
    return this.ctx.decodeAudioData(data);
  }
}
