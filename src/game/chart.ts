import type { Song } from "../data/library";
import { packPose } from "../pose/normalize";
import { POSE_LIBRARY, buildPose } from "./poses";

export interface Keyframe {
  /** 판정 시각(초) */
  t: number;
  /** 33개 관절 정규화 좌표 [x, y] */
  pose: [number, number][];
  /** 포즈 라이브러리에서 고른 포즈면 그 인덱스 */
  lib?: number;
  /** 에디터에서 관절을 끌어 직접 고친 포즈 */
  edited?: true;
}

export interface Chart {
  version: 2;
  id: string;
  songId: string;
  author: string;
  createdAt: number;
  keyframes: Keyframe[];
}

export function newChart(song: Song, author: string, keyframes: Keyframe[]): Chart {
  return { version: 2, id: crypto.randomUUID(), songId: song.id, author, createdAt: Date.now(), keyframes };
}

export const libraryPose = (idx: number) => packPose(buildPose(POSE_LIBRARY[idx]));

/** 곡의 박자마다 포즈 라이브러리에서 무작위로(연속 중복 없이) 고른 채보 */
export function libraryChart(song: Song, author: string): Chart {
  let last = -1;
  const keyframes = song.beats.map((t) => {
    let idx: number;
    do idx = Math.floor(Math.random() * POSE_LIBRARY.length);
    while (idx === last);
    last = idx;
    return { t, pose: libraryPose(idx), lib: idx };
  });
  return newChart(song, author, keyframes);
}
