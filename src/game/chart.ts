import { poseBeats } from "../audio/beat";
import type { Song } from "../audio/songs";
import { packPose } from "../pose/normalize";
import { POSE_LIBRARY, buildPose, seededRandom } from "./poses";

export interface Keyframe {
  /** 판정 박자 */
  beat: number;
  /** 33개 관절 정규화 좌표 [x, y] */
  pose: [number, number][];
}

export interface Chart {
  version: 1;
  id: string;
  songId: string;
  songTitle: string;
  bpm: number;
  offsetMs: number;
  /** 몇 박마다 포즈 하나 */
  interval: number;
  author: string;
  createdAt: number;
  keyframes: Keyframe[];
}

export const LEAD_IN_BEATS = 8;

export function newChart(song: Song, interval: number, author: string, keyframes: Keyframe[] = []): Chart {
  return {
    version: 1,
    id: crypto.randomUUID(),
    songId: song.id,
    songTitle: song.title,
    bpm: song.bpm,
    offsetMs: song.offsetMs,
    interval,
    author,
    createdAt: Date.now(),
    keyframes,
  };
}

/** 기본 수록곡용 안무: 포즈 라이브러리에서 시드 고정으로 뽑는다 */
export function makeBuiltinChart(song: Song, durationSec: number): Chart {
  const interval = song.bpm >= 130 ? 4 : 2;
  const rand = seededRandom(song.id);
  let last = -1;
  const keyframes = poseBeats(song, interval, LEAD_IN_BEATS, durationSec).map((beat) => {
    let idx: number;
    do idx = Math.floor(rand() * POSE_LIBRARY.length);
    while (idx === last);
    last = idx;
    return { beat, pose: packPose(buildPose(POSE_LIBRARY[idx])) };
  });
  return { ...newChart(song, interval, "포트뮤", keyframes), id: `builtin-${song.id}` };
}

// ---- 저장 (localStorage) ----

const KEY = "ptm.charts";

export function loadSavedCharts(): Chart[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Chart[]) : [];
  } catch {
    return [];
  }
}

export function saveChart(chart: Chart) {
  const all = loadSavedCharts().filter((c) => c.id !== chart.id);
  all.unshift(chart);
  try {
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 50)));
  } catch (err) {
    console.warn("안무 저장 실패", err);
  }
}

export function deleteChart(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadSavedCharts().filter((c) => c.id !== id)));
  } catch {
    /* 무시 */
  }
}
