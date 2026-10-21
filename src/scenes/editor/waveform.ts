import { MIN_GAP } from "../../audio/beat";
import { h } from "../../ui";
import type { BeatModel } from "./beats";

/** 초당 피크 개수 */
const PEAKS_PER_SEC = 200;
const RULER = 22;
const HEIGHT = 200;
const HIT_PX = 6;

const COLOR = {
  bg: "#181818",
  ruler: "#1d1d1d",
  grid: "#2c2c2c",
  text: "#7a7a7a",
  wave: "#4a4a4a",
  beat: "#bdbdbd",
  warn: "#e0b44c",
  accent: "#ff5a36",
  band: "rgba(255, 90, 54, 0.12)",
};

/** 채널 평균의 구간별 min/max */
function computePeaks(buffer: AudioBuffer) {
  const n = Math.ceil(buffer.duration * PEAKS_PER_SEC);
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const per = buffer.sampleRate / PEAKS_PER_SEC;
  for (let p = 0; p < n; p++) {
    let lo = 0;
    let hi = 0;
    const end = Math.min(buffer.length, Math.floor((p + 1) * per));
    for (let i = Math.floor(p * per); i < end; i++) {
      let s = 0;
      for (const c of chans) s += c[i];
      s /= chans.length;
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    min[p] = lo;
    max[p] = hi;
  }
  return { min, max };
}

/** 표시 간격에 맞는 눈금 단위(초) */
function tickStep(pxPerSec: number) {
  for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]) if (s * pxPerSec >= 70) return s;
  return 120;
}

/**
 * 파형 + 박자 마커 타임라인.
 * - 위쪽 눈금 영역: 클릭/드래그로 재생 위치 이동
 * - 파형 영역: 빈 곳 클릭 = 박자 추가, 드래그 = 범위 선택, 마커 드래그 = 이동
 * - 휠 = 스크롤, Ctrl+휠 = 확대/축소
 */
export class BeatTrack {
  readonly el: HTMLElement;
  pxPerSec = 120;
  /** 화면 왼쪽 끝 시각 */
  scroll = 0;
  playhead = 0;
  onSeek: (t: number) => void = () => {};

  private canvas: HTMLCanvasElement;
  private scrollbar: HTMLInputElement;
  private peaks: { min: Float32Array; max: Float32Array };
  private duration: number;
  private model: BeatModel;
  private band: [number, number] | null = null;
  private width = 0;

  constructor(buffer: AudioBuffer, model: BeatModel) {
    this.duration = buffer.duration;
    this.model = model;
    this.peaks = computePeaks(buffer);
    this.canvas = h("canvas", { class: "track-canvas" });
    this.scrollbar = h("input", {
      type: "range",
      class: "track-scroll",
      min: 0,
      step: 0.01,
      oninput: () => {
        this.scroll = Number(this.scrollbar.value);
        this.draw();
      },
    });
    this.el = h("div", { class: "beat-track" }, this.canvas, this.scrollbar);

    this.canvas.addEventListener("pointerdown", (e) => this.pointerDown(e));
    this.canvas.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    new ResizeObserver(() => this.resize()).observe(this.el);
  }

  private get visibleSec() {
    return this.width / this.pxPerSec;
  }

  private xOf(t: number) {
    return (t - this.scroll) * this.pxPerSec;
  }

  private tOf(x: number) {
    return Math.min(this.duration, Math.max(0, this.scroll + x / this.pxPerSec));
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = this.canvas.clientWidth;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(HEIGHT * dpr);
    this.canvas.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.clampScroll();
    this.draw();
  }

  private clampScroll() {
    const max = Math.max(0, this.duration - this.visibleSec);
    this.scroll = Math.min(max, Math.max(0, this.scroll));
    this.scrollbar.max = String(max);
    this.scrollbar.value = String(this.scroll);
    this.scrollbar.disabled = max === 0;
  }

  /** 확대/축소 (anchor 시각이 화면에서 제자리에 있도록) */
  zoom(factor: number, anchorT = this.playhead) {
    const minPps = this.width / Math.max(1, this.duration);
    const x = this.xOf(anchorT);
    this.pxPerSec = Math.min(2000, Math.max(minPps, this.pxPerSec * factor));
    this.scroll = anchorT - x / this.pxPerSec;
    this.clampScroll();
    this.draw();
  }

  /** 재생 중: 재생 위치가 화면 밖으로 나가면 따라간다 */
  follow() {
    const x = this.xOf(this.playhead);
    if (x > this.width * 0.85 || x < 0) {
      this.scroll = this.playhead - this.visibleSec * 0.15;
      this.clampScroll();
    }
  }

  draw() {
    const ctx = this.canvas.getContext("2d")!;
    const W = this.width;
    const H = HEIGHT;
    const { model } = this;
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = COLOR.ruler;
    ctx.fillRect(0, 0, W, RULER);

    // 눈금
    const step = tickStep(this.pxPerSec);
    ctx.font = "11px 'Pretendard Variable', system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (let t = Math.floor(this.scroll / step) * step; t < this.scroll + this.visibleSec; t += step) {
      const x = Math.round(this.xOf(t)) + 0.5;
      ctx.fillStyle = COLOR.grid;
      ctx.fillRect(x, RULER - 6, 1, 6);
      ctx.fillRect(x, RULER, 1, H - RULER);
      ctx.fillStyle = COLOR.text;
      const sec = Math.round(t);
      const label = step < 1 ? t.toFixed(step < 0.5 ? 2 : 1) : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
      ctx.fillText(label, x + 4, RULER / 2);
    }

    // 파형
    const mid = RULER + (H - RULER) / 2;
    const amp = (H - RULER) / 2 - 8;
    const { min, max } = this.peaks;
    ctx.fillStyle = COLOR.wave;
    for (let x = 0; x < W; x++) {
      const a = Math.floor((this.scroll + x / this.pxPerSec) * PEAKS_PER_SEC);
      const b = Math.max(a + 1, Math.floor((this.scroll + (x + 1) / this.pxPerSec) * PEAKS_PER_SEC));
      let lo = 0;
      let hi = 0;
      for (let p = a; p < b && p < min.length; p++) {
        if (min[p] < lo) lo = min[p];
        if (max[p] > hi) hi = max[p];
      }
      if (hi - lo > 0) ctx.fillRect(x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
    }

    // 범위 선택
    if (this.band) {
      const [a, b] = this.band;
      ctx.fillStyle = COLOR.band;
      ctx.fillRect(this.xOf(Math.min(a, b)), RULER, Math.abs(b - a) * this.pxPerSec, H - RULER);
    }

    // 박자 마커
    const beats = model.beats;
    beats.forEach((t, i) => {
      const x = this.xOf(t);
      if (x < -10 || x > W + 10) return;
      const tight = (i > 0 && t - beats[i - 1] < MIN_GAP) || (i < beats.length - 1 && beats[i + 1] - t < MIN_GAP);
      const sel = model.selected.has(t);
      ctx.fillStyle = sel ? COLOR.accent : tight ? COLOR.warn : COLOR.beat;
      ctx.fillRect(Math.round(x) - (sel ? 1 : 0), RULER, sel ? 2 : 1, H - RULER);
      ctx.beginPath();
      ctx.moveTo(x - 5, RULER);
      ctx.lineTo(x + 5, RULER);
      ctx.lineTo(x, RULER + 7);
      ctx.closePath();
      ctx.fill();
    });

    // 재생 위치
    const px = Math.round(this.xOf(this.playhead));
    ctx.fillStyle = COLOR.accent;
    ctx.fillRect(px - 1, 0, 2, H);
  }

  private hit(x: number): number | null {
    let best: number | null = null;
    let bestD = HIT_PX;
    for (const t of this.model.beats) {
      const d = Math.abs(this.xOf(t) - x);
      if (d <= bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  private pointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const x0 = e.clientX - rect.left;
    const y0 = e.clientY - rect.top;
    const t0 = this.tOf(x0);
    const { model } = this;
    this.canvas.setPointerCapture(e.pointerId);

    let move: (x: number) => void;
    let up: (moved: boolean) => void;

    if (y0 < RULER) {
      // 재생 위치 이동
      move = (x) => this.onSeek(this.tOf(x));
      up = () => {};
      this.onSeek(t0);
    } else {
      const hit = this.hit(x0);
      if (hit !== null) {
        // 마커 선택 + 드래그 이동
        if (e.shiftKey) model.toggle(hit);
        else if (!model.selected.has(hit)) model.select([hit]);
        const orig = [...model.selected];
        const rest = model.beats.filter((b) => !model.selected.has(b));
        let checkpointed = false;
        move = (x) => {
          if (!checkpointed) {
            model.checkpoint();
            checkpointed = true;
          }
          const dt = (x - x0) / this.pxPerSec;
          const moved = orig.map((b) => Math.min(this.duration, Math.max(0, b + dt)));
          model.set([...rest, ...moved], moved);
        };
        up = () => {};
      } else {
        // 빈 곳: 클릭 = 박자 추가, 드래그 = 범위 선택
        move = (x) => {
          this.band = [t0, this.tOf(x)];
          this.draw();
        };
        up = (moved) => {
          if (!moved) model.add(t0);
          else if (this.band) {
            const [a, b] = [Math.min(...this.band), Math.max(...this.band)];
            model.select(
              model.beats.filter((t) => t >= a && t <= b),
              e.shiftKey,
            );
          }
          this.band = null;
          this.draw();
        };
      }
    }

    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const x = ev.clientX - rect.left;
      if (!moved && Math.abs(x - x0) < 4) return;
      moved = true;
      move(x);
    };
    const onUp = () => {
      this.canvas.removeEventListener("pointermove", onMove);
      this.canvas.removeEventListener("pointerup", onUp);
      this.canvas.removeEventListener("pointercancel", onUp);
      up(moved);
    };
    this.canvas.addEventListener("pointermove", onMove);
    this.canvas.addEventListener("pointerup", onUp);
    this.canvas.addEventListener("pointercancel", onUp);
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const x = e.clientX - this.canvas.getBoundingClientRect().left;
      this.zoom(Math.exp(-e.deltaY * 0.002), this.tOf(x));
      return;
    }
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    this.scroll += d / this.pxPerSec;
    this.clampScroll();
    this.draw();
  }
}
