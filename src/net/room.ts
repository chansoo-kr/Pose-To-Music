import { joinRoom, selfId, type Room } from "trystero";
import type { App } from "../app";
import { libraryHashes, loadAudio, type Song } from "../data/library";
import type { Chart } from "../game/chart";
import type { Difficulty } from "../pose/joints";
import { channel, request } from "./channel";
import { clockNow, measureOffset } from "./clock";
import {
  JOIN_TIMEOUT_MS,
  PROTOCOL,
  RECV_CHART_BYTES,
  RECV_SMALL_BYTES,
  RECV_SONG_BYTES,
  RECV_STATE_BYTES,
  SONG_SEND_CONCURRENCY,
  gameRoomId,
  newRoomCode,
  passwordProof,
  roomConfig,
} from "./config";
import { LobbyHost } from "./lobby";
import {
  parseChart,
  parseHello,
  parseLive,
  parseRank,
  parseResultMsg,
  parseSongMeta,
  parseStart,
  parseState,
  parseStatus,
  toArrayBuffer,
  unpackMiniPose,
  type CheckReq,
  type CheckRes,
  type GameMode,
  type Hello,
  type LiveMsg,
  type MemberState,
  type MemberStatus,
  type Phase,
  type RankMsg,
  type ResultMsg,
  type RoomInfo,
  type RoomSettings,
  type RoomState,
  type StartMsg,
  type StatusMsg,
} from "./protocol";
import { acceptSong, chartMetaOf, findLocalSong, receivedHashes, songMetaOf, withMeta } from "./transfer";

export type CloseReason = "left" | "host-left" | "full" | "playing" | "version" | "timeout" | "wrong-password" | "unreachable";

export const CLOSE_TEXT: Record<CloseReason, string> = {
  left: "방에서 나왔어요.",
  "host-left": "방장이 방을 닫았어요.",
  full: "방이 가득 찼어요.",
  playing: "이미 게임 중인 방이에요.",
  version: "게임 버전이 달라요. 페이지를 새로고침해 주세요.",
  timeout: "방을 찾을 수 없거나 비밀번호가 달라요.",
  "wrong-password": "비밀번호가 맞지 않아요.",
  unreachable: "방장과 연결할 수 없어요. 네트워크가 막혀 있으면 설정에서 TURN 서버를 넣어 보세요.",
};

type KickReason = "full" | "playing" | "version";

export interface NetEvents {
  /** 방 상태(설정·참가자·상태)가 바뀜 */
  change(): void;
  start(msg: StartMsg): void;
  live(peerId: string, msg: LiveMsg): void;
  pose(peerId: string, pose: [number, number][]): void;
  rank(msg: RankMsg): void;
  closed(reason: CloseReason): void;
  /** 방장만: 참가자의 결과 / 녹화한 채보 / 참가자 이탈 */
  result(peerId: string, msg: ResultMsg): void;
  submit(peerId: string, round: number, chart: Chart | null): void;
  leave(peerId: string): void;
}

export interface HostOptions {
  name: string;
  max: number;
  mode: GameMode;
  level: Difficulty;
  password: string;
  song: Song;
  chart: Chart | null;
}

export type SettingsInput = Omit<HostOptions, "password">;

/**
 * 게임 방 하나. 방장이 상태의 기준이고(별 모양), 데이터 연결은 Trystero 풀 메시.
 * - 방장: 참가자 목록·설정·상태를 모아 `state`로 뿌리고, 곡·채보를 나눠 준다
 * - 참가자: 방장에게 자기 상태를 알리고, 곡을 받아 준비한다
 */
export class NetRoom {
  readonly code: string;
  readonly isHost: boolean;
  readonly selfId = selfId;
  state: RoomState | null = null;
  /** 플레이할 곡 (방장 박자 적용, 디코딩 완료). 준비 전엔 null */
  song: Song | null = null;
  /** 기본 모드에서 모두가 플레이할 채보 */
  chart: Chart | null = null;
  /** 참가자의 준비 버튼 */
  ready = false;
  /** 곡 받기 진행률 */
  progress = 0;
  events: Partial<NetEvents> = {};

  private app: App;
  private room: Room;
  private closed = false;
  private offset = 0;
  private preparing: string | null = null;
  /** 받은 곡의 해시를 확인하는 중 */
  private verifying = false;
  private songHash: string | null = null;
  private readyKey = "";
  private lastStatus: StatusMsg | null = null;

  private ch;

  // 방장
  private password = "";
  private lobby: LobbyHost | null = null;
  private hostSong: Song | null = null;
  private hashes = new Map<string, Set<string>>();
  private queue: string[] = [];
  private sending = new Set<string>();
  private attempts = new Map<string, number>();
  private timers: number[] = [];
  private broadcastTimer = 0;

  // 참가자
  private hostId: string | null = null;
  private expectedHost: string | null;
  private hello: Hello | null = null;

  private constructor(app: App, code: string, isHost: boolean, password: string, expectedHost: string | null = null) {
    this.app = app;
    this.code = code;
    this.isHost = isHost;
    this.expectedHost = expectedHost;
    this.room = joinRoom(roomConfig(app.settings, password), gameRoomId(code), {
      onJoinError: ({ error }) => {
        console.warn("[net] join error", error);
        if (this.isHost || this.state) return;
        this.close(/password/i.test(error) ? "wrong-password" : "unreachable");
      },
    });
    const r = this.room;
    this.ch = {
      hello: channel<Hello>(r, "hello", RECV_STATE_BYTES * 4),
      state: channel<RoomState>(r, "state", RECV_STATE_BYTES),
      status: channel<StatusMsg>(r, "status", RECV_SMALL_BYTES),
      kick: channel<{ reason: KickReason }>(r, "kick", RECV_SMALL_BYTES),
      song: channel<Blob>(r, "song", RECV_SONG_BYTES),
      chart: channel<Chart>(r, "chart", RECV_CHART_BYTES),
      start: channel<StartMsg>(r, "start", RECV_CHART_BYTES),
      live: channel<LiveMsg>(r, "live", RECV_SMALL_BYTES),
      pose: channel<Int16Array>(r, "pose", RECV_SMALL_BYTES),
      result: channel<ResultMsg>(r, "result", RECV_SMALL_BYTES),
      rank: channel<RankMsg>(r, "rank", RECV_STATE_BYTES),
      clock: request<null, number>(r, "clock", RECV_SMALL_BYTES),
    };

    this.ch.live.on((data, peerId) => {
      const msg = parseLive(data);
      if (msg && this.member(peerId)) this.events.live?.(peerId, msg);
    });
    this.ch.pose.on((data, peerId) => {
      const pose = unpackMiniPose(data);
      if (pose && this.member(peerId)) this.events.pose?.(peerId, pose);
    });
  }

  // ---------------------------------------------------------------- 만들기 / 참가

  static async host(app: App, opts: HostOptions): Promise<NetRoom> {
    const room = new NetRoom(app, newRoomCode(), true, opts.password);
    room.password = opts.password;
    room.hostSong = opts.song;
    room.chart = opts.chart;
    room.state = {
      v: PROTOCOL,
      code: room.code,
      hostId: selfId,
      locked: !!opts.password,
      settings: await room.settingsOf(opts),
      members: [{ id: selfId, name: app.settings.nickname, status: "loading", progress: 1, ping: null }],
      phase: "waiting",
      round: 0,
    };
    room.initHost();
    return room;
  }

  /**
   * @param hostId 방 목록에서 알게 된 방장 id (방 코드로 참가할 땐 없음)
   */
  static async join(app: App, code: string, password: string, hostId: string | null = null): Promise<NetRoom> {
    const hello: Hello = {
      v: PROTOCOL,
      name: app.settings.nickname,
      hashes: [...new Set([...(await libraryHashes()), ...receivedHashes()])],
    };
    const room = new NetRoom(app, code, false, password, hostId);
    room.hello = hello;
    room.initGuest();
    return room;
  }

  private async settingsOf(opts: SettingsInput): Promise<RoomSettings> {
    return {
      name: opts.name,
      max: opts.max,
      mode: opts.mode,
      level: opts.level,
      song: await songMetaOf(opts.song),
      chart: opts.mode === "classic" && opts.chart ? chartMetaOf(opts.chart) : null,
    };
  }

  // ---------------------------------------------------------------- 방장

  private initHost() {
    const { ch } = this;
    this.lobby = new LobbyHost(
      this.app.settings,
      () => this.info(),
      (req) => this.answerCheck(req),
    );
    ch.clock.answer(() => clockNow());

    ch.hello.on((data, peerId) => {
      const hello = parseHello(data);
      if (!hello || !this.state) return;
      if (hello.v !== PROTOCOL) return this.kick(peerId, "version");
      const known = this.member(peerId);
      if (known) {
        known.name = hello.name;
        this.scheduleBroadcast();
        return;
      }
      if (this.state.phase !== "waiting") return this.kick(peerId, "playing");
      if (this.state.members.length >= this.state.settings.max) return this.kick(peerId, "full");
      this.hashes.set(peerId, new Set(hello.hashes));
      this.state.members.push({ id: peerId, name: hello.name, status: "connecting", progress: 0, ping: null });
      this.broadcastNow();
      if (this.chart && this.state.settings.mode === "classic") void ch.chart.send(this.chart, peerId);
      this.queueSong(peerId);
      this.events.change?.();
    });

    ch.status.on((data, peerId) => {
      const msg = parseStatus(data);
      const m = this.member(peerId);
      if (!msg || !m) return;
      m.status = msg.status;
      m.progress = msg.progress;
      this.scheduleBroadcast();
      this.events.change?.();
    });

    ch.result.on((data, peerId) => {
      const msg = parseResultMsg(data);
      if (msg && this.member(peerId)) this.events.result?.(peerId, msg);
    });

    ch.chart.on((data, peerId, metadata) => {
      if (!this.member(peerId)) return;
      const meta = metadata as { kind?: string; round?: number } | undefined;
      if (meta?.kind !== "submit" || typeof meta.round !== "number") return;
      const chart = parseChart(data);
      this.events.submit?.(peerId, meta.round, chart && chart.keyframes.length ? chart : null);
    });

    this.room.onPeerLeave = (peerId) => {
      if (!this.state || !this.member(peerId)) return;
      this.state.members = this.state.members.filter((m) => m.id !== peerId);
      this.queue = this.queue.filter((id) => id !== peerId);
      this.hashes.delete(peerId);
      this.broadcastNow();
      this.events.leave?.(peerId);
      this.events.change?.();
    };

    // 핑은 표시용
    this.timers.push(
      window.setInterval(() => {
        for (const m of this.state?.members ?? []) {
          if (m.id === selfId) continue;
          this.room
            .ping(m.id)
            .then((ms) => {
              m.ping = Math.round(ms);
              this.scheduleBroadcast();
            })
            .catch(() => {});
        }
      }, 5000),
    );

    void this.prepareSong();
  }

  /** 방 목록에 보일 정보 */
  private info(): RoomInfo {
    const s = this.state!;
    return {
      v: PROTOCOL,
      code: this.code,
      name: s.settings.name,
      host: this.app.settings.nickname,
      hostId: selfId,
      mode: s.settings.mode,
      song: s.settings.song?.title ?? "",
      level: s.settings.level,
      players: s.members.length,
      max: s.settings.max,
      locked: s.locked,
      playing: s.phase !== "waiting",
    };
  }

  private async answerCheck(req: CheckReq): Promise<CheckRes> {
    const s = this.state;
    if (!s || req.code !== this.code) return "gone";
    if (s.phase !== "waiting") return "playing";
    if (s.members.length >= s.settings.max) return "full";
    if (this.password && req.proof !== (await passwordProof(this.code, this.password))) return "wrong";
    return "ok";
  }

  private kick(peerId: string, reason: KickReason) {
    void this.ch.kick.send({ reason }, peerId);
  }

  /** 방장: 설정 바꾸기 */
  async updateSettings(input: SettingsInput) {
    if (!this.isHost || !this.state) return;
    const settings = await this.settingsOf(input);
    const songChanged = settings.song?.hash !== this.state.settings.song?.hash;
    const chartChanged = settings.chart?.id !== this.state.settings.chart?.id;
    this.hostSong = input.song;
    this.chart = input.mode === "classic" ? input.chart : null;
    this.state.settings = settings;
    if (songChanged) {
      this.attempts.clear();
      for (const m of this.state.members) if (m.id !== selfId) this.queueSong(m.id);
    }
    if (chartChanged && this.chart) void this.ch.chart.send(this.chart);
    this.broadcastNow();
    await this.prepareSong();
  }

  /** 곡이 없는 참가자에게 곡을 보낸다 (동시에 SONG_SEND_CONCURRENCY명) */
  private queueSong(peerId: string) {
    const hash = this.state?.settings.song?.hash;
    if (!hash || this.hashes.get(peerId)?.has(hash)) return;
    if (this.queue.includes(peerId) || this.sending.has(peerId)) return;
    this.queue.push(peerId);
    this.pumpSongs();
  }

  private pumpSongs() {
    while (this.sending.size < SONG_SEND_CONCURRENCY && this.queue.length) {
      const peerId = this.queue.shift()!;
      const song = this.hostSong;
      const meta = this.state?.settings.song;
      if (!song || !meta || !this.member(peerId)) continue;
      const key = `${peerId}:${meta.hash}`;
      const tries = (this.attempts.get(key) ?? 0) + 1;
      if (tries > 2) continue;
      this.attempts.set(key, tries);
      this.sending.add(peerId);
      void this.ch.song.send(song.audio, peerId, { metadata: { ...meta } }).then(() => {
        this.sending.delete(peerId);
        if (this.closed) return;
        this.hashes.get(peerId)?.add(meta.hash);
        // 보내는 동안 곡이 바뀌었으면 다시
        if (this.state?.settings.song?.hash !== meta.hash) this.queueSong(peerId);
        this.pumpSongs();
      });
    }
  }

  private scheduleBroadcast() {
    if (this.broadcastTimer) return;
    this.broadcastTimer = window.setTimeout(() => this.broadcastNow(), 50);
  }

  private broadcastNow() {
    window.clearTimeout(this.broadcastTimer);
    this.broadcastTimer = 0;
    if (this.state && !this.closed) void this.ch.state.send(this.state);
  }

  /** 방장: 진행 단계 바꾸기 */
  setPhase(phase: Phase, round = this.state?.round ?? 0) {
    if (!this.isHost || !this.state) return;
    this.state.phase = phase;
    this.state.round = round;
    this.broadcastNow();
    this.events.change?.();
  }

  sendStart(msg: StartMsg, target?: string) {
    void this.ch.start.send(msg, target);
  }

  sendRank(msg: RankMsg) {
    void this.ch.rank.send(msg);
  }

  // ---------------------------------------------------------------- 참가자

  private initGuest() {
    const { ch } = this;

    this.room.onPeerJoin = (peerId) => {
      if (this.hello) void ch.hello.send(this.hello, peerId);
    };

    ch.state.on((data, peerId) => {
      const state = parseState(data);
      if (!state || state.hostId !== peerId || state.code !== this.code) return;
      if (this.expectedHost && peerId !== this.expectedHost) return;
      if (this.hostId && peerId !== this.hostId) return;
      const first = !this.state;
      this.hostId = peerId;
      this.state = state;
      if (!state.members.some((m) => m.id === selfId)) {
        // 방장이 아직 hello를 처리하지 않음
        if (this.hello) void ch.hello.send(this.hello, peerId);
      }
      if (first) void this.syncClock();
      void this.prepareSong();
      this.events.change?.();
    });

    ch.kick.on((data, peerId) => {
      if (this.hostId && peerId !== this.hostId) return;
      if (this.expectedHost && peerId !== this.expectedHost) return;
      const reason = (data as { reason?: string } | null)?.reason;
      this.close(reason === "full" || reason === "playing" || reason === "version" ? reason : "playing");
    });

    ch.song.onProgress((p, peerId) => {
      if (peerId !== this.hostId || this.verifying) return;
      this.progress = Math.max(this.progress, p);
      this.report();
    });

    ch.song.on((data, peerId, metadata) => {
      const bytes = toArrayBuffer(data);
      if (peerId !== this.hostId || !bytes) return;
      const meta = parseSongMeta(metadata);
      if (!meta) return;
      this.verifying = true;
      this.report();
      void acceptSong(bytes, meta).then((song) => {
        if (!song) console.warn("[net] 받은 곡의 해시가 맞지 않음");
        this.verifying = false;
        this.progress = 0;
        void this.prepareSong();
      });
    });

    ch.chart.on((data, peerId) => {
      if (peerId !== this.hostId) return;
      const chart = parseChart(data);
      if (chart && chart.id === this.state?.settings.chart?.id) {
        this.chart = chart;
        this.report();
        this.events.change?.();
      }
    });

    ch.start.on((data, peerId) => {
      const msg = parseStart(data);
      if (msg && peerId === this.hostId) this.events.start?.(msg);
    });

    ch.rank.on((data, peerId) => {
      const msg = parseRank(data);
      if (msg && peerId === this.hostId) this.events.rank?.(msg);
    });

    this.room.onPeerLeave = (peerId) => {
      if (peerId === this.hostId) this.close("host-left");
    };

    this.timers.push(
      window.setTimeout(() => {
        if (!this.state) this.close("timeout");
      }, JOIN_TIMEOUT_MS),
    );
  }

  private async syncClock() {
    const hostId = this.hostId;
    if (!hostId) return;
    const res = await measureOffset(() => this.ch.clock.ask(null, hostId, 2000));
    if (res) this.offset = res.offset;
  }

  setReady(ready: boolean) {
    this.ready = ready;
    if (ready) void this.syncClock();
    this.report();
    this.events.change?.();
  }

  sendResult(msg: ResultMsg) {
    if (this.hostId) void this.ch.result.send(msg, this.hostId);
  }

  submitChart(chart: Chart | null, round: number) {
    if (!this.hostId) return;
    const empty: Chart = { version: 2, id: crypto.randomUUID(), songId: "", author: "", createdAt: Date.now(), keyframes: [] };
    void this.ch.chart.send(chart ?? empty, this.hostId, { metadata: { kind: "submit", round } });
  }

  // ---------------------------------------------------------------- 공통

  member(peerId: string): MemberState | undefined {
    return this.state?.members.find((m) => m.id === peerId);
  }

  get members(): MemberState[] {
    return this.state?.members ?? [];
  }

  sendLive(msg: LiveMsg) {
    void this.ch.live.send(msg);
  }

  sendPose(pose: Int16Array) {
    void this.ch.pose.send(pose);
  }

  /** 방장 시계 기준 지금 */
  hostNow() {
    return clockNow() + this.offset;
  }

  /** 방장 시계 시각 → 이 기기의 performance.now() 시각 */
  toLocal(hostMs: number) {
    return hostMs - this.offset - performance.timeOrigin;
  }

  /** 모드·곡·채보가 바뀌면 준비를 풀어야 한다 */
  private get prepKey() {
    const s = this.state?.settings;
    return `${s?.mode}|${s?.song?.hash}|${s?.chart?.id}`;
  }

  /** 곡을 찾아(없으면 받을 때까지 기다림) 디코딩한다 */
  private async prepareSong() {
    if (this.prepKey !== this.readyKey) {
      this.readyKey = this.prepKey;
      this.ready = false;
    }
    const meta = this.state?.settings.song;
    if (!meta) {
      this.song = null;
      return this.report();
    }
    if (this.song && this.songHash === meta.hash) {
      this.song = withMeta(this.song, meta);
      return this.report();
    }
    if (this.preparing === meta.hash) return this.report();

    this.song = null;
    this.preparing = meta.hash;
    try {
      const base = this.isHost ? this.hostSong : await findLocalSong(meta.hash);
      if (!base) return;
      this.report();
      await loadAudio(base, this.app.audio.ctx);
      if (this.state?.settings.song?.hash !== meta.hash || this.closed) return;
      this.song = withMeta(base, meta);
      this.songHash = meta.hash;
    } catch (err) {
      console.error(err);
    } finally {
      if (this.preparing === meta.hash) this.preparing = null;
      this.report();
      this.events.change?.();
    }
  }

  private computeStatus(): MemberStatus {
    const s = this.state;
    if (!s) return "connecting";
    if (!this.song) return this.preparing || this.verifying ? "loading" : "downloading";
    if (s.settings.mode === "classic" && this.chart?.id !== s.settings.chart?.id) return "downloading";
    return this.isHost || this.ready ? "ready" : "waiting";
  }

  /** 내 상태를 방장에게 알린다 (방장은 자기 항목을 고친다) */
  private report() {
    const status = this.computeStatus();
    const progress = status === "downloading" ? this.progress : 1;
    if (this.isHost) {
      const me = this.member(selfId);
      if (me && (me.status !== status || me.progress !== progress)) {
        me.status = status;
        me.progress = progress;
        this.scheduleBroadcast();
        this.events.change?.();
      }
      return;
    }
    const last = this.lastStatus;
    if (!this.hostId) return;
    if (last && last.status === status && Math.abs(last.progress - progress) < 0.05 && progress < 1) return;
    if (last && last.status === status && last.progress === progress) return;
    this.lastStatus = { status, progress };
    void this.ch.status.send(this.lastStatus, this.hostId);
  }

  get status(): MemberStatus {
    return this.computeStatus();
  }

  /** 나가기 */
  leave() {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.timers) {
      window.clearInterval(t);
      window.clearTimeout(t);
    }
    window.clearTimeout(this.broadcastTimer);
    this.lobby?.close();
    void this.room.leave();
  }

  private close(reason: CloseReason) {
    if (this.closed) return;
    this.leave();
    this.events.closed?.(reason);
  }
}
