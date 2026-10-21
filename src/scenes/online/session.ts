import type { App, Scene } from "../../app";
import { playRange } from "../../audio/beat";
import { findSongByHash, getSong, saveChart, saveSong } from "../../data/library";
import { assignCharts } from "../../game/assign";
import type { Chart } from "../../game/chart";
import type { PlayResult } from "../../game/scoring";
import { RESULT_GRACE_MS, START_DELAY_MS } from "../../net/config";
import { packMiniPose, type LiveMsg, type RankMsg, type RankRow, type StartMsg } from "../../net/protocol";
import { CLOSE_TEXT, type NetRoom } from "../../net/room";
import { normalize } from "../../pose/normalize";
import { PlayScene } from "../play";
import { RecordScene } from "../record";
import { liveBoard } from "./board";
import { OnlineEntryScene } from "./entry";
import { LobbyScene } from "./lobby";
import { ResultsScene, WaitScene } from "./results";
import { RoomsScene } from "./rooms";

/** 온라인 방 화면 표시 (이 화면으로 옮겨도 방을 닫지 않는다) */
export function onlineScene<T extends Scene>(scene: T): T {
  (scene as Scene).online = true;
  return scene;
}

const POSE_INTERVAL_MS = 100;

/**
 * 온라인 방 한 판의 진행.
 * 방장: 시작 → (녹화 수집 → 교환 →) 플레이 → 결과 모으기 → 순위 발표
 * 참가자: 방장의 start / rank 메시지를 따라 화면을 옮긴다
 */
export class OnlineSession {
  readonly app: App;
  readonly net: NetRoom;
  /** 이번 판 실시간 점수 (내 것 포함) */
  readonly live = new Map<string, LiveMsg>();
  /** 다른 사람 포즈 미니뷰 */
  readonly poses = new Map<string, { pose: [number, number][]; at: number }>();
  lastRank: RankMsg | null = null;
  /** 이번 판에 내가 녹화한 채보 / 따라 한 채보 */
  myChart: Chart | null = null;
  playedChart: Chart | null = null;
  /** 대기실에 띄울 안내 */
  notice = "";

  private round = 0;
  private inRound = false;
  private listeners = new Set<() => void>();
  private poseOff: (() => void) | null = null;
  // 방장
  private results = new Map<string, PlayResult | null>();
  private submits = new Map<string, Chart | null>();
  private assign = new Map<string, string>();
  private timer = 0;

  constructor(app: App, net: NetRoom) {
    app.session?.close();
    this.app = app;
    this.net = net;
    app.session = this;
    net.events = {
      change: () => this.emit(),
      start: (msg) => this.onStart(msg),
      live: (peerId, msg) => {
        if (msg.round === this.round) this.live.set(peerId, msg);
      },
      pose: (peerId, pose) => this.poses.set(peerId, { pose, at: performance.now() }),
      rank: (msg) => this.onRank(msg),
      closed: (reason) => this.toRooms(CLOSE_TEXT[reason]),
      result: (peerId, msg) => {
        if (msg.round !== this.round || this.net.state?.phase !== "play") return;
        this.results.set(peerId, msg.result);
        this.checkRound();
      },
      submit: (peerId, round, chart) => {
        if (round !== this.round || this.net.state?.phase !== "record") return;
        this.submits.set(peerId, chart);
        this.checkRound();
      },
      leave: () => this.checkRound(),
    };
  }

  get name() {
    return this.app.settings.nickname;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  openLobby() {
    this.app.go(onlineScene(new LobbyScene(this)));
  }

  /** 나가기 (온라인 화면이 아닌 곳으로 가면 App.go가 close를 부른다) */
  exit() {
    this.app.go(new OnlineEntryScene(this.app));
  }

  private toRooms(message: string) {
    this.app.go(new RoomsScene(this.app, message));
  }

  close() {
    window.clearTimeout(this.timer);
    this.stopPose();
    this.listeners.clear();
    this.net.events = {};
    this.net.leave();
    if (this.app.session === this) this.app.session = null;
  }

  // ---------------------------------------------------------------- 방장

  get canStart() {
    const s = this.net.state;
    return (
      this.net.isHost &&
      !!s &&
      s.phase === "waiting" &&
      s.members.length >= 2 &&
      s.members.every((m) => m.status === "ready")
    );
  }

  startRound() {
    if (!this.canStart) return;
    const s = this.net.state!;
    const round = s.round + 1;
    this.results.clear();
    this.submits.clear();
    this.assign.clear();
    const stage = s.settings.mode === "classic" ? "play" : "record";
    const msg: StartMsg = { round, stage, startAt: this.net.hostNow() + START_DELAY_MS };
    this.net.setPhase(stage, round);
    this.net.sendStart(msg);
    this.armTimer();
    this.onStart(msg);
  }

  /** 정해진 시간이 지나면 남은 사람을 기다리지 않고 넘어간다 */
  private armTimer() {
    window.clearTimeout(this.timer);
    const song = this.net.song;
    if (!song) return;
    const range = playRange(song.beats, song.durationSec);
    const ms = START_DELAY_MS + (range.end - range.from + range.leadIn) * 1000 + RESULT_GRACE_MS;
    this.timer = window.setTimeout(() => {
      const phase = this.net.state?.phase;
      if (phase === "record") this.beginPlayStage();
      else if (phase === "play") this.finalize();
    }, ms);
  }

  private checkRound() {
    if (!this.net.isHost) return;
    const ids = this.net.members.map((m) => m.id);
    const phase = this.net.state?.phase;
    if (phase === "record" && ids.every((id) => this.submits.has(id))) this.beginPlayStage();
    else if (phase === "play" && ids.every((id) => this.results.has(id))) this.finalize();
  }

  /** 프리스타일: 모은 채보를 섞어 나눠 주고 동시에 플레이 */
  private beginPlayStage() {
    const ids = this.net.members.map((m) => m.id);
    const owners = ids.filter((id) => this.submits.get(id));
    this.assign = assignCharts(ids, owners);
    if (!this.assign.size) return this.finalize();

    const startAt = this.net.hostNow() + START_DELAY_MS;
    this.net.setPhase("play", this.round);
    let mine: StartMsg | null = null;
    for (const id of ids) {
      const from = this.assign.get(id)!;
      const msg: StartMsg = { round: this.round, stage: "play", startAt, chart: this.submits.get(from)!, from };
      if (id === this.net.selfId) mine = msg;
      else this.net.sendStart(msg, id);
    }
    this.armTimer();
    if (mine) this.onStart(mine);
  }

  private finalize() {
    window.clearTimeout(this.timer);
    const s = this.net.state;
    if (!s) return;
    const rows: RankRow[] = s.members.map((m) => ({
      id: m.id,
      name: m.name,
      result: this.results.get(m.id) ?? null,
      ...(this.assign.has(m.id) ? { from: this.assign.get(m.id) } : {}),
    }));
    rows.sort((a, b) => (b.result?.score ?? -1) - (a.result?.score ?? -1));
    const msg: RankMsg = { round: this.round, mode: s.settings.mode, rows };
    this.net.setPhase("waiting");
    this.net.sendRank(msg);
    this.onRank(msg);
  }

  // ---------------------------------------------------------------- 공통

  private onStart(msg: StartMsg) {
    const { app, net } = this;
    const s = net.state;
    this.round = msg.round;
    this.live.clear();
    this.lastRank = null;
    if (msg.stage === "record") this.myChart = this.playedChart = null;
    this.notice = "";
    const song = net.song;
    const chart = msg.stage === "play" ? (s?.settings.mode === "classic" ? net.chart : (msg.chart ?? null)) : null;
    if (!s || !song || (msg.stage === "play" && !chart)) {
      // 곡을 아직 못 받음 — 이번 판은 빠진다
      this.inRound = true;
      return msg.stage === "record" ? this.submit(null) : this.finishPlay(null);
    }

    this.inRound = true;
    const startAt = net.toLocal(msg.startAt);
    this.startPose();
    if (msg.stage === "record") {
      app.go(
        onlineScene(
          new RecordScene(app, {
            song,
            author: this.name,
            startAt,
            overlay: liveBoard(this),
            onDone: (c) => this.submit(c),
            onBack: () => this.submit(null),
          }),
        ),
      );
      return;
    }

    this.playedChart = chart;
    this.live.set(net.selfId, { round: msg.round, score: 0, combo: 0 });
    app.go(
      onlineScene(
        new PlayScene(app, {
          song,
          chart: chart!,
          difficulty: s.settings.level,
          playerName: this.name,
          startAt,
          overlay: liveBoard(this),
          onScore: (score, combo) => {
            const live = { round: msg.round, score, combo };
            this.live.set(net.selfId, live);
            net.sendLive(live);
          },
          onDone: (result) => this.finishPlay(result),
          onBack: () => this.finishPlay(null),
        }),
      ),
    );
  }

  /** 녹화 끝 (null = 그만둠) */
  private submit(chart: Chart | null) {
    this.stopPose();
    this.inRound = false;
    const valid = chart && chart.keyframes.length ? chart : null;
    this.myChart = valid;
    this.showWait("다른 사람의 녹화를 기다리는 중…");
    if (this.net.isHost) {
      this.submits.set(this.net.selfId, valid);
      this.checkRound();
    } else this.net.submitChart(valid, this.round);
  }

  /** 플레이 끝 (null = 그만둠) */
  private finishPlay(result: PlayResult | null) {
    this.stopPose();
    this.inRound = false;
    if (this.lastRank?.round === this.round) return this.showResults();
    this.showWait("결과를 기다리는 중…");
    if (this.net.isHost) {
      this.results.set(this.net.selfId, result);
      this.checkRound();
    } else this.net.sendResult({ round: this.round, result });
  }

  private onRank(msg: RankMsg) {
    this.lastRank = msg;
    if (!this.inRound) this.showResults();
  }

  private showWait(text: string) {
    this.app.go(onlineScene(new WaitScene(this, text)));
  }

  private showResults() {
    this.app.go(onlineScene(new ResultsScene(this)));
  }

  private startPose() {
    this.stopPose();
    const { app, net } = this;
    let last = 0;
    this.poseOff = app.tracker.onFrame((lms) => {
      const now = performance.now();
      if (!lms || now - last < POSE_INTERVAL_MS) return;
      const pose = normalize(lms, app.tracker.aspect);
      if (!pose) return;
      last = now;
      net.sendPose(packMiniPose(pose));
    });
  }

  private stopPose() {
    this.poseOff?.();
    this.poseOff = null;
  }

  /** 받은 곡(없으면)과 채보를 내 라이브러리에 저장 */
  async saveCharts(charts: Chart[]): Promise<number> {
    const { net } = this;
    const meta = net.state?.settings.song;
    const song = net.song;
    if (!meta || !song) return 0;
    let local = await findSongByHash(meta.hash);
    if (!local) {
      const exists = await getSong(song.id);
      local = { ...song, id: exists ? crypto.randomUUID() : song.id, updatedAt: Date.now() };
      await saveSong(local);
    }
    for (const c of charts) await saveChart({ ...c, songId: local.id });
    return charts.length;
  }
}
