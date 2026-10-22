import { download, safeName } from "../data/io";
import type { Difficulty } from "../pose/joints";
import type { NormPose } from "../pose/normalize";
import type { Grade, Leniency } from "./scoring";

/**
 * 판정 기록 (설정 "디버그 정보"를 켰을 때만 모은다).
 * 판정 구간 안의 포즈 샘플을 그대로 담아서, scripts/rejudge.mjs로 다른 판정 방식으로 다시 채점할 수 있다.
 */
export interface JudgeLog {
  format: "ptm-judge-log";
  version: 1;
  createdAt: number;
  song: string;
  chartAuthor: string;
  difficulty: Difficulty;
  leniency: Leniency;
  latencyMs: number;
  judgments: JudgeEntry[];
}

export interface JudgeEntry {
  /** 판정 시각(초) */
  t: number;
  /** 판정 구간 ±(초) */
  window: number;
  /** 목표 포즈 [x, y] */
  target: [number, number][];
  best: number;
  grade: Grade;
  /** 구간 안 포즈 샘플: 곡 시각, 관절 [x, y, visibility] */
  samples: { t: number; pose: [number, number, number][] }[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const packSample = (pose: NormPose): [number, number, number][] => pose.map((j) => [r3(j.x), r3(j.y), r3(j.v)]);

export function downloadJudgeLog(log: JudgeLog) {
  const stamp = new Date(log.createdAt).toISOString().slice(0, 19).replace(/[:T]/g, "-");
  download(new Blob([JSON.stringify(log)], { type: "application/json" }), `${safeName(log.song)}-${stamp}.judge.json`);
}
