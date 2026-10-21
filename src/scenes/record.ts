import type { App, Scene } from "../app";
import { beatSec, beatToTime, poseBeats } from "../audio/beat";
import type { Song } from "../audio/songs";
import { LEAD_IN_BEATS, newChart, type Chart, type Keyframe } from "../game/chart";
import { packPose, unpackPose } from "../pose/normalize";
import { button, h, icon, panel, panelHeader } from "../ui";
import { Countdown, PoseSampler, Timeline, loadSong, readyGate, sessionHeader } from "./session";

export interface RecordOptions {
  song: Song;
  interval: number;
  author: string;
  color?: string;
  onDone(chart: Chart): void;
  onBack(): void;
}

/** 캡처 시점 이후 이 시간만큼 기다렸다가 가장 가까운 프레임을 고른다 */
const CAPTURE_SETTLE = 0.15;

/**
 * 안무 녹화: 음악에 맞춰 정해진 박자마다 플레이어의 포즈를 스냅샷으로 저장한다.
 */
export class RecordScene implements Scene {
  readonly immersive = true;
  private app: App;
  private opts: RecordOptions;
  private root!: HTMLElement;
  private hud: HTMLElement | null = null;
  private sampler: PoseSampler | null = null;
  private timeline: Timeline | null = null;
  private countdown = new Countdown();
  private counter = h("div", { class: "hud-counter" });
  private flash = h("div", { class: "flash" });

  private times: number[] = [];
  private beats: number[] = [];
  private keyframes: Keyframe[] = [];
  private shutterIdx = 0;
  private captureIdx = 0;
  private phase: "idle" | "recording" | "review" = "idle";
  private endTime = 0;
  private lastCaptureAt = -Infinity;
  private reviewStart = 0;
  private alive = true;

  constructor(app: App, opts: RecordOptions) {
    this.app = app;
    this.opts = opts;
  }

  enter(root: HTMLElement) {
    this.root = root;
    void this.begin();
  }

  exit() {
    this.alive = false;
    this.sampler?.dispose();
  }

  private async begin() {
    const { app, opts, root } = this;
    root.replaceChildren();
    this.phase = "idle";
    this.app.stage.ghost.setPoints(null, 1);

    const buffer = await loadSong(root, opts.song);
    if (!this.alive) return;
    const ok = await readyGate(
      app,
      root,
      `${opts.author}의 안무 녹화`,
      `"${opts.song.title}" · ${opts.interval}박마다 포즈 1개 · 상대방이 따라 할 포즈를 박자에 맞춰 취하세요`,
    );
    if (!this.alive) return;
    if (!ok) return opts.onBack();

    const endSec =
      opts.song.source === "upload" ? Math.min(buffer.duration, app.settings.maxSongSec) : buffer.duration;
    this.beats = poseBeats(opts.song, opts.interval, LEAD_IN_BEATS, endSec);
    this.times = this.beats.map((b) => beatToTime(opts.song, b));
    this.keyframes = [];
    this.shutterIdx = 0;
    this.captureIdx = 0;
    this.endTime = endSec;

    this.sampler?.dispose();
    this.sampler = new PoseSampler(app);
    this.timeline = new Timeline(this.times);
    this.hud = h(
      "div",
      { class: "hud" },
      sessionHeader(`${opts.author} · 녹화 중`, opts.song.title, opts.color, true),
      this.counter,
      this.countdown.el,
      this.timeline.el,
      h("div", { class: "hud-bottom-left" }, button("다시 시작", () => this.abort(), "glass small", "refresh")),
    );
    root.append(this.hud, this.flash);

    app.audio.play(buffer, { leadIn: 0.5, endAt: endSec, onEnded: () => this.finish() });
    this.phase = "recording";
  }

  private abort() {
    this.app.audio.stop();
    void this.begin();
  }

  update() {
    if (this.phase === "recording") this.updateRecording();
    else if (this.phase === "review") this.updateReview();
  }

  private updateRecording() {
    const { app } = this;
    const now = app.audio.songTime();
    const poseNow = app.poseSongTime();

    // 셔터음은 박자에 정확히, 실제 프레임 선택은 조금 뒤에
    while (this.shutterIdx < this.times.length && now >= this.times[this.shutterIdx]) {
      this.shutterIdx++;
      app.audio.sfx("shutter");
      this.flash.classList.remove("on");
      void this.flash.offsetWidth;
      this.flash.classList.add("on");
    }
    while (this.captureIdx < this.times.length && poseNow >= this.times[this.captureIdx] + CAPTURE_SETTLE) {
      const pose = this.sampler!.nearest(this.times[this.captureIdx], 0.25);
      if (pose) {
        this.keyframes.push({ beat: this.beats[this.captureIdx], pose: packPose(pose) });
        this.lastCaptureAt = now;
      }
      this.captureIdx++;
    }

    // 방금 찍은 포즈를 잠깐 고스트로 보여준다
    const last = this.keyframes[this.keyframes.length - 1];
    if (last && now - this.lastCaptureAt < 0.5) {
      const anchor = app.stage.playerAnchor ?? app.stage.defaultAnchor();
      app.stage.ghost.opacity = 0.6 * (1 - (now - this.lastCaptureAt) / 0.5);
      app.stage.ghost.setPoints(app.stage.placeNorm(unpackPose(last.pose), anchor), anchor.torso);
    } else {
      app.stage.ghost.setPoints(null, 1);
    }

    this.timeline!.update(now, this.shutterIdx);
    this.countdown.update(now, this.times[0] ?? 0, beatSec(this.opts.song));
    this.counter.textContent = `${this.keyframes.length} / ${this.times.length} 포즈`;

    if (this.captureIdx >= this.times.length && now > this.endTime) this.finish();
  }

  private finish() {
    if (this.phase !== "recording") return;
    this.app.audio.stop();
    this.phase = "review";
    this.reviewStart = performance.now();
    this.hud?.remove();
    this.flash.remove();

    const n = this.keyframes.length;
    const total = this.times.length;
    const tooFew = n < 3;
    const review = panel(
        panelHeader(`${this.opts.author}의 녹화 완료`, { kicker: "Review" }),
        h("div", { class: "stat-inline" }, h("strong", null, String(n)), h("span", null, ` / ${total} 포즈`)),
        tooFew ? h("p", { class: "warn" }, "포즈가 너무 적어요. 전신이 잘 보이게 다시 녹화해 주세요.") : null,
        h("p", { class: "muted" }, "녹화한 포즈가 화면에 차례대로 재생됩니다."),
        h(
          "div",
          { class: "row" },
          button("다시 녹화", () => void this.begin(), "ghost", "refresh"),
          h(
            "button",
            {
              class: "btn primary",
              disabled: tooFew,
              onclick: () =>
                this.opts.onDone(newChart(this.opts.song, this.opts.interval, this.opts.author, this.keyframes)),
            },
            icon("check", 18),
            h("span", null, "확정"),
          ),
        ),
      );
    review.classList.add("dock");
    this.root.append(review);
  }

  private updateReview() {
    if (!this.keyframes.length) return;
    const { stage } = this.app;
    const i = Math.floor((performance.now() - this.reviewStart) / 700) % this.keyframes.length;
    const anchor = stage.playerAnchor ?? stage.defaultAnchor();
    stage.ghost.opacity = 0.7;
    stage.ghost.setPoints(stage.placeNorm(unpackPose(this.keyframes[i].pose), anchor), anchor.torso);
  }
}
