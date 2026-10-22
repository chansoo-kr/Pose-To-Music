import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { App } from "../app";
import { COUNTDOWN_SEC } from "../audio/beat";
import { loadAudio, type Song } from "../data/library";
import { isFullBodyVisible, normalize, type NormPose } from "../pose/normalize";
import { drawMiniPose } from "../render/minipose";
import { button, h, icon, panel, panelHeader } from "../ui";

/**
 * 전신이 보일 때까지 기다린다. 1.5초 동안 계속 보이면 자동으로 넘어가고,
 * "바로 시작"으로 건너뛸 수도 있다.
 * @returns false면 취소
 */
function readyRing() {
  const R = 52;
  const C = 2 * Math.PI * R;
  const el = h("div", { class: "ready-ring" });
  el.innerHTML =
    `<svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="${R}"/>` +
    `<circle class="fill" cx="60" cy="60" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>`;
  el.append(h("span", { class: "ready-ring-icon" }, icon("user", 34)));
  const fill = el.querySelector<SVGCircleElement>(".fill")!;
  return { el, set: (p: number) => (fill.style.strokeDashoffset = String(C * (1 - p))) };
}

const bodyText = (app: App, ok: boolean) =>
  ok ? "좋아요! 그대로 있어 주세요" : app.tracker.latest ? "전신이 다 보이지 않아요" : "사람이 보이지 않아요";

export function readyGate(app: App, root: HTMLElement, title: string, subtitle = ""): Promise<boolean> {
  return new Promise((resolve) => {
    const status = h("div", { class: "ready-status" }, "인식 중…");
    const ring = readyRing();
    const ringWrap = ring.el;
    const el = panel(
      panelHeader(title, { sub: subtitle }),
      h("div", { class: "ready-body" }, ringWrap, h("div", null, status, h("p", { class: "muted" }, "머리부터 발끝까지 화면에 보이도록 뒤로 물러나 주세요."))),
      h(
        "div",
        { class: "row" },
        button("취소", () => done(false), "ghost"),
        button("바로 시작", () => done(true), "primary", "play"),
      ),
    );
    el.classList.add("ready-gate", "dock");
    root.append(el);

    let since = 0;
    const timer = window.setInterval(() => {
      const ok = isFullBodyVisible(app.tracker.latest);
      const now = performance.now();
      if (!ok) since = 0;
      else if (!since) since = now;
      const p = since ? Math.min(1, (now - since) / 1500) : 0;
      ring.set(p);
      status.textContent = bodyText(app, ok);
      status.classList.toggle("ok", ok);
      if (p >= 1) done(true);
    }, 100);

    function done(v: boolean) {
      window.clearInterval(timer);
      el.remove();
      resolve(v);
    }
  });
}

/**
 * 온라인 시작 전 안내: 정해진 시각까지 남은 시간과 전신 인식 상태를 보여 준다 (기다리지는 않음).
 */
export class BodyHint {
  readonly el: HTMLElement;
  private timer: number;

  constructor(app: App, title: string, startAt: number) {
    const status = h("div", { class: "ready-status" });
    const remain = h("strong", { class: "hint-remain" });
    const ring = readyRing();
    this.el = panel(
      panelHeader(title),
      h("div", { class: "ready-body" }, ring.el, h("div", null, status, h("p", { class: "muted" }, "머리부터 발끝까지 화면에 보이도록 뒤로 물러나 주세요."))),
      h("div", { class: "hint-start" }, "시작까지 ", remain),
    );
    this.el.classList.add("ready-gate", "dock");
    const tick = () => {
      const ok = isFullBodyVisible(app.tracker.latest);
      ring.set(ok ? 1 : 0);
      status.textContent = bodyText(app, ok);
      status.classList.toggle("ok", ok);
      remain.textContent = `${Math.max(0, Math.ceil((startAt - performance.now()) / 1000))}초`;
    };
    tick();
    this.timer = window.setInterval(tick, 100);
  }

  dispose() {
    window.clearInterval(this.timer);
    this.el.remove();
  }
}

export async function loadSong(app: App, root: HTMLElement, song: Song): Promise<AudioBuffer> {
  const el = h("div", { class: "loading-pill" }, h("span", { class: "spinner" }), `${song.title} 불러오는 중…`);
  root.append(el);
  try {
    return await loadAudio(song, app.audio.ctx);
  } finally {
    el.remove();
  }
}

export interface TimelineOptions {
  /** 박자마다 목표 포즈 ([x, y] 33개) — 있으면 원 안에 스켈레톤을 그려 미리 보여 준다 */
  poses?: [number, number][][];
  /** 원 안에서 강조할 판정 관절 */
  joints?: number[];
  /** 판정선까지 보여 주는 시간(초) */
  lookahead?: number;
}

interface TimelineItem {
  t: number;
  el: HTMLElement | null;
  /** 판정이 끝나 사라지는 중이거나 사라짐 */
  gone: boolean;
}

/** 판정선 위치 (타임라인 너비 비율) */
const JUDGE_AT = 0.12;
/** 포즈 원 지름 (px) */
const POSE_SIZE = 56;

/**
 * 화면 하단 박자 타임라인: 판정선으로 원이 흘러 들어온다.
 * 포즈를 주면 원 안에 그 박자의 목표 포즈를 그린다 (원마다 한 번만, 보이기 시작할 때).
 */
export class Timeline {
  readonly el = h("div", { class: "timeline" }, h("div", { class: "timeline-judge" }));
  private items: TimelineItem[];
  private opts: TimelineOptions;
  private lookahead: number;
  private width = 0;
  private resize: ResizeObserver;

  constructor(times: number[], opts: TimelineOptions = {}) {
    this.opts = opts;
    this.lookahead = opts.lookahead ?? 3;
    this.items = times.map((t) => ({ t, el: null, gone: false }));
    if (opts.poses) this.el.classList.add("with-poses");
    this.resize = new ResizeObserver(() => (this.width = this.el.clientWidth));
    this.resize.observe(this.el);
  }

  update(now: number, doneCount: number) {
    const width = (this.width ||= this.el.clientWidth);
    if (!width) return;
    const judgeX = width * JUDGE_AT;
    const half = this.opts.poses ? POSE_SIZE / 2 : 7;
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (item.gone && !item.el) continue;
      const x = judgeX + ((item.t - now) / this.lookahead) * (width - judgeX);
      if (x > width + half) break; // 시각순이라 뒤는 모두 안 보임
      // 판정 없이 지나간 원 (미리보기) 또는 화면 왼쪽 밖
      if ((i < doneCount && !item.gone) || x < -half) {
        this.remove(item);
        continue;
      }
      const el = (item.el ??= this.create(i));
      const next = i === doneCount && !item.gone;
      el.classList.toggle("next", next);
      el.style.transform = `translateX(${x.toFixed(1)}px)${next && this.opts.poses ? " scale(1.15)" : ""}`;
    }
  }

  /** 판정 결과: 원을 판정 색으로 바꾸고 흐리게 사라지게 한다 */
  judge(index: number, grade: string) {
    const item = this.items[index];
    if (!item || item.gone) return;
    item.gone = true;
    if (!item.el) return;
    item.el.classList.remove("next");
    item.el.classList.add("judged", `grade-${grade.toLowerCase()}`);
    window.setTimeout(() => this.remove(item), 300);
  }

  dispose() {
    this.resize.disconnect();
  }

  private remove(item: TimelineItem) {
    item.gone = true;
    item.el?.remove();
    item.el = null;
  }

  private create(i: number): HTMLElement {
    const pose = this.opts.poses?.[i];
    const el = h("div", { class: pose ? "timeline-pose" : "timeline-marker", style: `z-index:${this.items.length - i}` });
    if (pose) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const canvas = h("canvas", { width: POSE_SIZE * dpr, height: POSE_SIZE * dpr });
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMiniPose(ctx, pose, POSE_SIZE, POSE_SIZE, {
        bone: "#ececec",
        lineWidth: 2.5,
        joints: this.opts.joints,
        joint: "#ff5a36",
        head: "#ececec",
      });
      el.append(canvas);
    }
    this.el.append(el);
    return el;
  }
}

/** 첫 포즈 직전 3·2·1 카운트다운 */
export class Countdown {
  readonly el = h("div", { class: "countdown" });
  private last = "";

  update(now: number, firstTime: number) {
    const remain = firstTime - now;
    let text = "";
    if (remain > 0 && remain <= COUNTDOWN_SEC) text = String(Math.ceil(remain));
    else if (remain > COUNTDOWN_SEC) text = "준비";
    if (text !== this.last) {
      this.last = text;
      this.el.textContent = text;
      this.el.classList.remove("pop");
      void this.el.offsetWidth;
      if (text) this.el.classList.add("pop");
    }
  }
}

/** 프레임마다 정규화 포즈를 곡 시간과 함께 모은다 */
export class PoseSampler {
  samples: { t: number; pose: NormPose }[] = [];
  private off: () => void;

  constructor(app: App, onSample?: (t: number, pose: NormPose) => void) {
    this.off = app.tracker.onFrame((lms: NormalizedLandmark[] | null) => {
      if (!lms) return;
      const pose = normalize(lms, app.tracker.aspect);
      if (!pose) return;
      const t = app.poseSongTime();
      this.samples.push({ t, pose });
      while (this.samples.length && this.samples[0].t < t - 3) this.samples.shift();
      onSample?.(t, pose);
    });
  }

  /** 시각 t에 가장 가까운 샘플 */
  nearest(t: number, maxDt: number): NormPose | null {
    let best: NormPose | null = null;
    let bestDt = maxDt;
    for (const s of this.samples) {
      const dt = Math.abs(s.t - t);
      if (dt <= bestDt) {
        bestDt = dt;
        best = s.pose;
      }
    }
    return best;
  }

  get latest(): NormPose | null {
    return this.samples[this.samples.length - 1]?.pose ?? null;
  }

  dispose() {
    this.off();
  }
}

export function sessionHeader(title: string, sub: string, color = "var(--text)", rec = false) {
  return h(
    "div",
    { class: "session-header" },
    h("span", { class: `session-dot${rec ? " rec" : ""}`, style: `--c:${color}` }),
    h("div", null, h("div", { class: "session-title" }, title), h("div", { class: "session-sub" }, sub)),
  );
}
