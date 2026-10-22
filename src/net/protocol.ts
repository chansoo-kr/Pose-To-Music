import type { Chart } from "../game/chart";
import { GRADES, LENIENCIES, type Leniency, type PlayResult } from "../game/scoring";
import { DIFFICULTIES, type Difficulty } from "../pose/joints";
import { MAX_PLAYERS, PROTOCOL } from "./config";

/*
 * 네트워크 메시지 타입과 수신 검증.
 * 다른 피어가 보낸 데이터는 모두 신뢰하지 않는 입력이다 — parse*()를 거쳐서만 쓴다.
 */

export type GameMode = "classic" | "freestyle";

export interface SongMeta {
  /** 방장 라이브러리의 곡 id (받은 곡을 저장할 때 씀) */
  id: string;
  /** 오디오 원본의 SHA-256 */
  hash: string;
  title: string;
  artist: string;
  audioName: string;
  type: string;
  size: number;
  durationSec: number;
  /** 방장 기준 박자. 같은 음악을 가진 참가자도 이 박자를 쓴다 */
  beats: number[];
}

export interface ChartMeta {
  id: string;
  author: string;
  poses: number;
}

export interface RoomSettings {
  name: string;
  max: number;
  mode: GameMode;
  level: Difficulty;
  /** 판정 여유 — 공정하도록 방 전체가 같은 값을 쓴다 */
  leniency: Leniency;
  song: SongMeta | null;
  /** 기본 모드에서 모두가 플레이할 채보 */
  chart: ChartMeta | null;
}

export type MemberStatus = "connecting" | "downloading" | "loading" | "waiting" | "ready";

export interface MemberState {
  id: string;
  name: string;
  status: MemberStatus;
  /** 곡 받기 진행률 0~1 */
  progress: number;
  /** 방장과의 RTT (ms) */
  ping: number | null;
}

export type Phase = "waiting" | "record" | "play";

export interface RoomState {
  v: number;
  code: string;
  hostId: string;
  locked: boolean;
  settings: RoomSettings;
  members: MemberState[];
  phase: Phase;
  round: number;
}

export interface Hello {
  v: number;
  name: string;
  /** 가지고 있는 곡의 오디오 해시 */
  hashes: string[];
}

export interface StatusMsg {
  status: MemberStatus;
  progress: number;
}

export interface StartMsg {
  round: number;
  stage: "record" | "play";
  /** 방장 시계 기준 음악 시작 시각 (ms) */
  startAt: number;
  /** 프리스타일 플레이: 따라 할 채보와 그 채보를 만든 사람 */
  chart?: Chart;
  from?: string;
}

export interface LiveMsg {
  round: number;
  score: number;
  combo: number;
}

export interface ResultMsg {
  round: number;
  /** null = 중간에 그만둠 */
  result: PlayResult | null;
}

export interface RankRow {
  id: string;
  name: string;
  result: PlayResult | null;
  /** 프리스타일: 따라 한 채보를 만든 사람 id */
  from?: string;
}

export interface RankMsg {
  round: number;
  mode: GameMode;
  rows: RankRow[];
}

export interface RoomInfo {
  v: number;
  code: string;
  name: string;
  host: string;
  hostId: string;
  mode: GameMode;
  song: string;
  level: Difficulty;
  leniency: Leniency;
  players: number;
  max: number;
  locked: boolean;
  playing: boolean;
}

export interface CheckReq {
  code: string;
  proof: string;
}

export type CheckRes = "ok" | "wrong" | "full" | "playing" | "gone";

// ---- 검증 ----

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const str = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");
const oneOf = <T extends string>(x: unknown, list: readonly T[]): T | null =>
  list.includes(x as T) ? (x as T) : null;

export const NAME_MAX = 12;
export const ROOM_NAME_MAX = 20;
export const cleanName = (x: unknown, max = NAME_MAX) => str(x, 64).replace(/\s+/g, " ").trim().slice(0, max);

const MODES = ["classic", "freestyle"] as const;
const STATUSES = ["connecting", "downloading", "loading", "waiting", "ready"] as const;
const PHASES = ["waiting", "record", "play"] as const;
const HEX64 = /^[0-9a-f]{64}$/;

function parseBeats(x: unknown): number[] | null {
  if (!Array.isArray(x) || x.length > 5000 || !x.every((b) => isNum(b) && b >= 0)) return null;
  return [...x].sort((a, b) => a - b);
}

export function parseSongMeta(x: unknown): SongMeta | null {
  if (!isObj(x) || typeof x.hash !== "string" || !HEX64.test(x.hash)) return null;
  const beats = parseBeats(x.beats);
  if (!beats || !isNum(x.size) || !isNum(x.durationSec)) return null;
  return {
    id: str(x.id, 64) || crypto.randomUUID(),
    hash: x.hash,
    title: str(x.title, 120) || "제목 없음",
    artist: str(x.artist, 120),
    audioName: str(x.audioName, 200),
    type: str(x.type, 64),
    size: x.size,
    durationSec: x.durationSec,
    beats,
  };
}

function parseChartMeta(x: unknown): ChartMeta | null {
  if (!isObj(x) || typeof x.id !== "string" || !isNum(x.poses)) return null;
  return { id: str(x.id, 64), author: cleanName(x.author, 40), poses: x.poses };
}

function parseMember(x: unknown): MemberState | null {
  if (!isObj(x) || typeof x.id !== "string") return null;
  return {
    id: str(x.id, 64),
    name: cleanName(x.name) || "이름 없음",
    status: oneOf(x.status, STATUSES) ?? "connecting",
    progress: isNum(x.progress) ? Math.min(1, Math.max(0, x.progress)) : 0,
    ping: isNum(x.ping) ? x.ping : null,
  };
}

export function parseState(x: unknown): RoomState | null {
  if (!isObj(x) || x.v !== PROTOCOL || !isObj(x.settings) || !Array.isArray(x.members)) return null;
  const s = x.settings;
  const mode = oneOf(s.mode, MODES);
  const level = oneOf(s.level, DIFFICULTIES);
  const phase = oneOf(x.phase, PHASES);
  if (!mode || !level || !phase || !isNum(x.round) || !isNum(s.max)) return null;
  const members = x.members.slice(0, MAX_PLAYERS).map(parseMember);
  if (members.some((m) => !m)) return null;
  return {
    v: PROTOCOL,
    code: str(x.code, 16),
    hostId: str(x.hostId, 64),
    locked: x.locked === true,
    settings: {
      name: cleanName(s.name, 40) || "방",
      max: Math.min(MAX_PLAYERS, Math.max(2, Math.round(s.max))),
      mode,
      level,
      leniency: oneOf(s.leniency, LENIENCIES) ?? "normal",
      song: s.song === null ? null : parseSongMeta(s.song),
      chart: s.chart === null ? null : parseChartMeta(s.chart),
    },
    members: members as MemberState[],
    phase,
    round: x.round,
  };
}

export function parseHello(x: unknown): Hello | null {
  if (!isObj(x) || !isNum(x.v) || !Array.isArray(x.hashes)) return null;
  return {
    v: x.v,
    name: cleanName(x.name) || "이름 없음",
    hashes: x.hashes.filter((h): h is string => typeof h === "string" && HEX64.test(h)).slice(0, 2000),
  };
}

export function parseStatus(x: unknown): StatusMsg | null {
  if (!isObj(x)) return null;
  const status = oneOf(x.status, STATUSES);
  if (!status) return null;
  return { status, progress: isNum(x.progress) ? Math.min(1, Math.max(0, x.progress)) : 0 };
}

/** 채보 검증: 33관절 [x, y], 시각은 숫자 */
export function parseChart(x: unknown): Chart | null {
  if (!isObj(x) || !Array.isArray(x.keyframes) || x.keyframes.length > 5000) return null;
  const keyframes = [];
  for (const k of x.keyframes) {
    if (!isObj(k) || !isNum(k.t) || !Array.isArray(k.pose) || k.pose.length !== 33) return null;
    const pose = k.pose.map((p) => (Array.isArray(p) && isNum(p[0]) && isNum(p[1]) ? [p[0], p[1]] : null));
    if (pose.some((p) => !p)) return null;
    keyframes.push({ t: k.t, pose: pose as [number, number][] });
  }
  return {
    version: 2,
    id: str(x.id, 64) || crypto.randomUUID(),
    songId: str(x.songId, 64),
    author: cleanName(x.author, 40),
    createdAt: isNum(x.createdAt) ? x.createdAt : Date.now(),
    keyframes,
  };
}

export function parseResult(x: unknown): PlayResult | null {
  if (!isObj(x) || !isNum(x.score) || !isNum(x.maxCombo) || !isNum(x.accuracy) || !isObj(x.counts)) return null;
  const counts = x.counts;
  if (!GRADES.every((g) => isNum(counts[g]))) return null;
  return {
    score: x.score,
    maxCombo: x.maxCombo,
    accuracy: x.accuracy,
    counts: Object.fromEntries(GRADES.map((g) => [g, counts[g] as number])) as PlayResult["counts"],
  };
}

export function parseStart(x: unknown): StartMsg | null {
  if (!isObj(x) || !isNum(x.round) || !isNum(x.startAt)) return null;
  const stage = oneOf(x.stage, ["record", "play"] as const);
  if (!stage) return null;
  const chart = x.chart === undefined ? undefined : parseChart(x.chart);
  if (chart === null) return null;
  return { round: x.round, stage, startAt: x.startAt, chart, from: x.from === undefined ? undefined : str(x.from, 64) };
}

export function parseLive(x: unknown): LiveMsg | null {
  if (!isObj(x) || !isNum(x.round) || !isNum(x.score) || !isNum(x.combo)) return null;
  return { round: x.round, score: x.score, combo: x.combo };
}

export function parseResultMsg(x: unknown): ResultMsg | null {
  if (!isObj(x) || !isNum(x.round)) return null;
  return { round: x.round, result: x.result === null ? null : parseResult(x.result) };
}

export function parseRank(x: unknown): RankMsg | null {
  if (!isObj(x) || !isNum(x.round) || !Array.isArray(x.rows)) return null;
  const mode = oneOf(x.mode, MODES);
  if (!mode) return null;
  const rows: RankRow[] = [];
  for (const r of x.rows.slice(0, MAX_PLAYERS)) {
    if (!isObj(r) || typeof r.id !== "string") return null;
    rows.push({
      id: str(r.id, 64),
      name: cleanName(r.name) || "이름 없음",
      result: r.result === null ? null : parseResult(r.result),
      from: r.from === undefined ? undefined : str(r.from, 64),
    });
  }
  return { round: x.round, mode, rows };
}

export function parseRoomInfo(x: unknown): RoomInfo | null {
  if (!isObj(x) || x.v !== PROTOCOL || typeof x.code !== "string" || typeof x.hostId !== "string") return null;
  const mode = oneOf(x.mode, MODES);
  const level = oneOf(x.level, DIFFICULTIES);
  if (!mode || !level || !isNum(x.players) || !isNum(x.max)) return null;
  return {
    v: PROTOCOL,
    code: str(x.code, 16),
    name: cleanName(x.name, 40) || "방",
    host: cleanName(x.host) || "이름 없음",
    hostId: str(x.hostId, 64),
    mode,
    song: str(x.song, 120),
    level,
    leniency: oneOf(x.leniency, LENIENCIES) ?? "normal",
    players: x.players,
    max: x.max,
    locked: x.locked === true,
    playing: x.playing === true,
  };
}

export function parseCheck(x: unknown): CheckReq | null {
  if (!isObj(x) || typeof x.code !== "string" || typeof x.proof !== "string") return null;
  return { code: str(x.code, 16), proof: str(x.proof, 64) };
}

/** 포즈 미니뷰: 33관절 [x, y] × 1000을 Int16으로 */
export function packMiniPose(pose: { x: number; y: number }[]): Int16Array {
  const out = new Int16Array(66);
  const clamp = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * 1000)));
  pose.forEach((p, i) => {
    out[i * 2] = clamp(p.x);
    out[i * 2 + 1] = clamp(p.y);
  });
  return out;
}

/** 받은 바이너리 (ArrayBuffer 또는 Uint8Array로 온다) → ArrayBuffer */
export function toArrayBuffer(x: unknown): ArrayBuffer | null {
  if (x instanceof ArrayBuffer) return x;
  if (ArrayBuffer.isView(x)) return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) as ArrayBuffer;
  return null;
}

export function unpackMiniPose(x: unknown): [number, number][] | null {
  const buf = toArrayBuffer(x);
  if (!buf || buf.byteLength !== 132) return null;
  const a = new Int16Array(buf);
  const out: [number, number][] = [];
  for (let i = 0; i < 33; i++) out.push([a[i * 2] / 1000, a[i * 2 + 1] / 1000]);
  return out;
}
