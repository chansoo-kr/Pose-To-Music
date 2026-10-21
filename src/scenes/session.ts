import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { App } from "../app";
import { COUNTDOWN_SEC } from "../audio/beat";
import { loadAudio, type Song } from "../data/library";
import { isFullBodyVisible, normalize, type NormPose } from "../pose/normalize";
import { button, h, icon, panel, panelHeader } from "../ui";

/**
 * 전신이 보일 때까지 기다린다. 1.5초 동안 계속 보이면 자동으로 넘어가고,
 * "바로 시작"으로 건너뛸 수도 있다.
 * @returns false면 취소
 */
export function readyGate(app: App, root: HTMLElement, title: string, subtitle = ""): Promise<boolean> {
  return new Promise((resolve) => {
    const status = h("div", { class: "ready-status" }, "인식 중…");
    const R = 52;
    const C = 2 * Math.PI * R;
    const ringWrap = h("div", { class: "ready-ring" });
    ringWrap.innerHTML =
      `<svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="${R}"/>` +
      `<circle class="fill" cx="60" cy="60" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>`;
    ringWrap.append(h("span", { class: "ready-ring-icon" }, icon("user", 34)));
    const ring = ringWrap.querySelector<SVGCircleElement>(".fill")!;
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
      ring.style.strokeDashoffset = String(C * (1 - p));
      status.textContent = ok ? "좋아요! 그대로 있어 주세요" : app.tracker.latest ? "전신이 다 보이지 않아요" : "사람이 보이지 않아요";
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

export async function loadSong(app: App, root: HTMLElement, song: Song): Promise<AudioBuffer> {
  const el = h("div", { class: "loading-pill" }, h("span", { class: "spinner" }), `${song.title} 불러오는 중…`);
  root.append(el);
  try {
    return await loadAudio(song, app.audio.ctx);
  } finally {
    el.remove();
  }
}

/** 화면 하단 박자 타임라인: 판정 지점으로 마커가 흘러 들어온다 */
export class Timeline {
  readonly el = h("div", { class: "timeline" }, h("div", { class: "timeline-judge" }));
  private markers: HTMLElement[];
  private times: number[];
  private lookahead: number;

  constructor(times: number[], lookahead = 3) {
    this.times = times;
    this.lookahead = lookahead;
    this.markers = times.map(() => {
      const m = h("div", { class: "timeline-marker" });
      this.el.append(m);
      return m;
    });
  }

  update(now: number, doneCount: number) {
    const JUDGE = 12;
    this.times.forEach((t, i) => {
      const m = this.markers[i];
      const x = JUDGE + ((t - now) / this.lookahead) * (100 - JUDGE);
      const visible = i >= doneCount && x < 102 && x > -5;
      m.style.display = visible ? "block" : "none";
      if (visible) m.style.left = `${x}%`;
    });
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
