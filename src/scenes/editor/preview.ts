import type { App, Scene } from "../../app";
import { playRange } from "../../audio/beat";
import type { Song } from "../../data/library";
import type { Chart } from "../../game/chart";
import { unpackPose } from "../../pose/normalize";
import { button, h } from "../../ui";
import { Countdown, Timeline, loadSong, sessionHeader } from "../session";

/** 채보 미리보기: 음악에 맞춰 목표 포즈를 고스트로 보여준다 (카메라 없이) */
export class PreviewScene implements Scene {
  readonly showPlayer = false;
  private app: App;
  private song: Song;
  private chart: Chart;
  private onBack: () => void;
  private timeline: Timeline | null = null;
  private countdown = new Countdown();
  private times: number[] = [];
  private playing = false;
  private alive = true;

  constructor(app: App, song: Song, chart: Chart, onBack: () => void) {
    this.app = app;
    this.song = song;
    this.chart = chart;
    this.onBack = onBack;
  }

  enter(root: HTMLElement) {
    void this.begin(root);
  }

  exit() {
    this.alive = false;
  }

  private async begin(root: HTMLElement) {
    const { app, chart } = this;
    const buffer = await loadSong(app, root, this.song);
    if (!this.alive) return;
    this.times = chart.keyframes.map((k) => k.t);
    const range = playRange(this.times, buffer.duration);
    this.timeline = new Timeline(this.times);
    root.append(
      h(
        "div",
        { class: "hud" },
        sessionHeader("미리보기", `${this.song.title} · ${chart.author}의 채보`),
        this.countdown.el,
        this.timeline.el,
        h("div", { class: "hud-bottom-left" }, button("닫기", this.onBack, "small", "x")),
      ),
    );
    app.audio.play(buffer, { from: range.from, leadIn: range.leadIn, endAt: range.end, onEnded: this.onBack });
    this.playing = true;
  }

  update() {
    if (!this.playing) return;
    const { stage, audio } = this.app;
    const now = audio.songTime();
    // 지금 맞춰야 할(또는 다가오는) 포즈
    const idx = this.times.findIndex((t) => t > now - 0.25);
    this.timeline!.update(now, idx < 0 ? this.times.length : idx);
    this.countdown.update(now, this.times[0] ?? 0);
    const k = this.chart.keyframes[idx];
    if (!k) {
      stage.ghost.setPoints(null, 1);
      return;
    }
    const prev = idx > 0 ? this.times[idx - 1] : k.t - 2;
    const approach = Math.min(1, Math.max(0, (k.t - now) / Math.min(2, Math.max(0.6, k.t - prev))));
    const anchor = stage.defaultAnchor();
    stage.ghost.opacity = 0.25 + 0.6 * (1 - approach);
    stage.ghost.setPoints(stage.placeNorm(unpackPose(k.pose), anchor), anchor.torso);
  }
}
