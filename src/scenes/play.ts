import * as THREE from "three";
import type { App, Scene } from "../app";
import { judgeWindows, playRange } from "../audio/beat";
import type { Song } from "../data/library";
import type { Chart } from "../game/chart";
import { packSample, type JudgeEntry, type JudgeLog } from "../game/judgelog";
import {
  ScoreKeeper,
  TIMING_WINDOW,
  jointScores,
  poseAccuracy,
  timedValue,
  type Grade,
  type Leniency,
  type PlayResult,
} from "../game/scoring";
import { DIFFICULTY_JOINTS, DIFFICULTY_LABEL, type Difficulty } from "../pose/joints";
import { unpackPose, type NormPose } from "../pose/normalize";
import { button, formatTime, h } from "../ui";
import { BodyHint, Countdown, PoseSampler, Timeline, loadSong, readyGate, sessionHeader } from "./session";

export interface PlayOptions {
  song: Song;
  chart: Chart;
  difficulty: Difficulty;
  /** 판정 여유 (싱글: 내 설정, 온라인: 방 설정) */
  leniency: Leniency;
  playerName: string;
  color?: string;
  /** 온라인: 이 시각(performance.now 기준 ms)에 음악을 시작한다. 전신 확인을 기다리지 않음 */
  startAt?: number;
  /** HUD에 붙일 요소 (온라인 순위 보드) */
  overlay?: Overlay;
  /** 판정마다 현재 점수·콤보 */
  onScore?(score: number, combo: number): void;
  /** @param log 설정 "디버그 정보"가 켜져 있을 때만 */
  onDone(result: PlayResult, log?: JudgeLog): void;
  onBack(): void;
}

export interface Overlay {
  el: HTMLElement;
  dispose(): void;
}

interface Target {
  time: number;
  /** 이 목표의 판정 윈도우(초) */
  window: number;
  pose: NormPose;
  best: number;
  /** 디버그 기록용 구간 안 샘플 */
  samples?: JudgeEntry["samples"];
}

const BAD = new THREE.Color(0xe05555);
const MID = new THREE.Color(0xe0b44c);
const GOOD = new THREE.Color(0xe8e8e8);

const packPoseXY = (p: NormPose): [number, number][] => p.map((j) => [j.x, j.y]);

function scoreColor(s: number) {
  return s < 0.5 ? BAD.clone().lerp(MID, s * 2) : MID.clone().lerp(GOOD, (s - 0.5) * 2);
}

/**
 * 안무 따라 하기: 박자마다 목표 포즈(고스트)와 플레이어 포즈를 비교해 점수를 낸다.
 */
export class PlayScene implements Scene {
  readonly immersive = true;
  private app: App;
  private opts: PlayOptions;
  private root!: HTMLElement;
  private joints: number[];
  private targets: Target[] = [];
  private judged = 0;
  private keeper = new ScoreKeeper();
  private sampler: PoseSampler | null = null;
  private timeline: Timeline | null = null;
  private countdown = new Countdown();
  private scoreEl = h("div", { class: "hud-score" }, "0");
  private comboEl = h("div", { class: "hud-combo" });
  private judgeLayer = h("div", { class: "judge-layer" });
  private progress = h("div", { class: "progress-fill" });
  private timeEl = h("div", { class: "hud-time" });
  private playing = false;
  private endTime = 0;
  private musicFrom = 0;
  private hint: BodyHint | null = null;
  private alive = true;
  private log: JudgeLog | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.playing) this.opts.onBack();
  };

  constructor(app: App, opts: PlayOptions) {
    this.app = app;
    this.opts = opts;
    this.joints = DIFFICULTY_JOINTS[opts.difficulty];
  }

  enter(root: HTMLElement) {
    this.root = root;
    void this.begin();
  }

  exit() {
    this.alive = false;
    window.removeEventListener("keydown", this.onKey);
    this.timeline?.dispose();
    this.sampler?.dispose();
    this.hint?.dispose();
    this.opts.overlay?.dispose();
  }

  private async begin() {
    const { app, opts, root } = this;
    const buffer = await loadSong(app, root, opts.song);
    if (!this.alive) return;
    if (opts.startAt === undefined) {
      const ok = await readyGate(
        app,
        root,
        `${opts.playerName}의 차례`,
        // 곡 제목 / 채보·난이도 두 줄. "관절 8개"는 줄바꿈되지 않게
        `${opts.song.title}\n${opts.chart.author}의 채보 · ${DIFFICULTY_LABEL[opts.difficulty]} · 관절\u00a0${this.joints.length}개`,
      );
      if (!this.alive) return;
      if (!ok) return opts.onBack();
    }

    const keyframes = [...opts.chart.keyframes].sort((a, b) => a.t - b.t);
    const times = keyframes.map((k) => k.t);
    const windows = judgeWindows(times, TIMING_WINDOW);
    this.targets = keyframes.map((k, i) => ({ time: k.t, window: windows[i], pose: unpackPose(k.pose), best: 0 }));
    const range = playRange(times, buffer.duration);
    this.endTime = range.end;
    this.musicFrom = range.from;

    if (app.settings.debug) {
      this.log = {
        format: "ptm-judge-log",
        version: 1,
        createdAt: Date.now(),
        song: opts.song.title,
        chartAuthor: opts.chart.author,
        difficulty: opts.difficulty,
        leniency: opts.leniency,
        latencyMs: app.settings.latencyMs,
        judgments: [],
      };
      for (const target of this.targets) target.samples = [];
    }

    // 판정 구간 안의 프레임마다 최고 점수 갱신
    this.sampler = new PoseSampler(app, (t, pose) => {
      for (let i = this.judged; i < this.targets.length; i++) {
        const target = this.targets[i];
        const dt = t - target.time;
        if (dt < -target.window) break;
        if (dt > target.window) continue;
        target.best = Math.max(
          target.best,
          timedValue(poseAccuracy(target.pose, pose, this.joints, opts.leniency), dt, target.window),
        );
        target.samples?.push({ t: Math.round(t * 1000) / 1000, pose: packSample(pose) });
      }
    });

    this.timeline = new Timeline(
      this.targets.map((t) => t.time),
      { poses: keyframes.map((k) => k.pose), joints: this.joints },
    );
    root.append(
      h(
        "div",
        { class: "hud" },
        h(
          "div",
          { class: "hud-top-left" },
          sessionHeader(opts.playerName, `${opts.song.title} · ${DIFFICULTY_LABEL[opts.difficulty]}`, opts.color),
          button("그만하기", () => opts.onBack(), "small", "x"),
        ),
        h("div", { class: "hud-right" }, this.timeEl, this.scoreEl, this.comboEl),
        h("div", { class: "progress" }, this.progress),
        this.countdown.el,
        this.judgeLayer,
        this.timeline.el,
        opts.overlay?.el,
      ),
    );
    window.addEventListener("keydown", this.onKey);

    // 온라인: 정해진 시각까지 무음으로 기다린다
    const wait = opts.startAt === undefined ? 0 : Math.max(0, (opts.startAt - performance.now()) / 1000);
    if (opts.startAt !== undefined) {
      this.hint = new BodyHint(app, `${opts.chart.author}의 채보 · ${DIFFICULTY_LABEL[opts.difficulty]}`, opts.startAt);
      root.append(this.hint.el);
    }

    app.audio.play(buffer, {
      from: range.from,
      leadIn: range.leadIn + wait,
      endAt: range.end,
      onEnded: () => this.finish(),
    });
    this.playing = true;
  }

  update() {
    if (!this.playing) return;
    const { app } = this;
    const now = app.audio.songTime();
    const poseNow = app.poseSongTime();
    if (this.hint && now >= this.musicFrom) {
      this.hint.dispose();
      this.hint = null;
    }

    while (this.judged < this.targets.length && poseNow > this.targets[this.judged].time + this.targets[this.judged].window) {
      this.judgeNext();
      this.opts.onScore?.(this.keeper.score, this.keeper.combo);
    }

    this.updateGhost(now);

    this.timeline!.update(now, this.judged);
    this.countdown.update(now, this.targets[0]?.time ?? 0);
    this.scoreEl.textContent = this.keeper.score.toLocaleString();
    this.comboEl.textContent = this.keeper.combo >= 2 ? `${this.keeper.combo} 콤보` : "";
    this.progress.style.width = `${Math.min(100, Math.max(0, (now / this.endTime) * 100))}%`;
    this.timeEl.textContent = `-${formatTime(Math.max(0, this.endTime - Math.max(now, 0)))}`;

    if (this.judged >= this.targets.length && now > this.endTime) this.finish();
  }

  private updateGhost(now: number) {
    const { stage } = this.app;
    // 아직 판정 시점이 지나지 않은 가장 가까운 목표
    let idx = this.judged;
    while (idx < this.targets.length && now > this.targets[idx].time + this.targets[idx].window) idx++;
    const target = this.targets[idx];
    if (!target) {
      stage.ghost.setPoints(null, 1);
      return;
    }

    const prevTime = idx > 0 ? this.targets[idx - 1].time : target.time - 2;
    const approachDur = Math.min(2, Math.max(0.6, target.time - prevTime));
    const approach = Math.min(1, Math.max(0, (target.time - now) / approachDur));
    if (approach >= 1) {
      stage.ghost.setPoints(null, 1);
      return;
    }

    const anchor = stage.playerAnchor ?? stage.defaultAnchor();
    stage.ghost.opacity = 0.2 + 0.55 * (1 - approach);
    stage.ghost.setPoints(stage.placeNorm(target.pose, anchor), anchor.torso);

    const live = this.sampler?.latest;
    const scores = live ? jointScores(target.pose, live, this.joints, this.opts.leniency) : this.joints.map(() => 0);
    stage.ghost.setMarkers(this.joints, scores.map(scoreColor), now < target.time ? approach : null);
  }

  /** 다음 목표를 판정한다 (지금까지의 최고 점수로) */
  private judgeNext(silent = false) {
    const index = this.judged++;
    const target = this.targets[index];
    const { grade, points } = this.keeper.add(target.best);
    this.timeline?.judge(index, grade);
    this.log?.judgments.push({
      t: target.time,
      window: target.window,
      target: packPoseXY(target.pose),
      best: target.best,
      grade,
      samples: target.samples ?? [],
    });
    if (!silent) this.showJudge(grade, points);
  }

  private showJudge(grade: Grade, points: number) {
    this.app.audio.sfx(grade === "PERFECT" ? "perfect" : grade === "MISS" ? "miss" : "good");
    const el = h(
      "div",
      { class: `judge judge-${grade.toLowerCase()}` },
      grade,
      points ? h("small", null, `+${points}`) : null,
    );
    this.judgeLayer.replaceChildren(el);
  }

  private finish() {
    if (!this.playing) return;
    this.playing = false;
    // 남은 목표는 지금까지의 최고 점수로 마무리
    while (this.judged < this.targets.length) this.judgeNext(true);
    this.app.audio.stop();
    this.app.stage.ghost.setPoints(null, 1);
    this.opts.onDone(this.keeper.result(), this.log ?? undefined);
  }
}
