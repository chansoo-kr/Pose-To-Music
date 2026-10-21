import type { NormPose } from "../pose/normalize";

export type Grade = "PERFECT" | "GREAT" | "GOOD" | "MISS";
export const GRADES: Grade[] = ["PERFECT", "GREAT", "GOOD", "MISS"];

/** 판정 시각 기준 ± 이 시간(초) 안의 프레임 중 최고 점수를 쓴다 (박자 간격이 좁으면 더 줄어듦) */
export const TIMING_WINDOW = 0.3;

/** 몸통 길이 단위 거리: 이 안이면 만점, ZERO 이상이면 0점 */
const PERFECT_DIST = 0.12;
const ZERO_DIST = 0.55;
const MIN_VISIBILITY = 0.3;

/** 관절별 점수(0~1) */
export function jointScores(target: NormPose, actual: NormPose, joints: number[]): number[] {
  return joints.map((j) => {
    const a = actual[j];
    if (a.v < MIN_VISIBILITY) return 0;
    const d = Math.hypot(a.x - target[j].x, a.y - target[j].y);
    return Math.min(1, Math.max(0, (ZERO_DIST - d) / (ZERO_DIST - PERFECT_DIST)));
  });
}

export function poseAccuracy(target: NormPose, actual: NormPose, joints: number[]): number {
  const s = jointScores(target, actual, joints);
  return s.reduce((a, b) => a + b, 0) / s.length;
}

/** 정확도 × 타이밍 가중치 (박자에서 멀수록 최대 25% 감점) */
export function timedValue(accuracy: number, dt: number, window = TIMING_WINDOW) {
  return accuracy * (1 - 0.25 * Math.min(1, Math.abs(dt) / window));
}

export function gradeOf(value: number): Grade {
  if (value >= 0.85) return "PERFECT";
  if (value >= 0.7) return "GREAT";
  if (value >= 0.5) return "GOOD";
  return "MISS";
}

export interface PlayResult {
  score: number;
  maxCombo: number;
  counts: Record<Grade, number>;
  /** 평균 정확도 0~1 */
  accuracy: number;
}

export class ScoreKeeper {
  score = 0;
  combo = 0;
  maxCombo = 0;
  counts: Record<Grade, number> = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
  private valueSum = 0;
  private judged = 0;

  /** @returns 이번 판정으로 얻은 점수 */
  add(value: number): { grade: Grade; points: number } {
    const grade = gradeOf(value);
    this.counts[grade]++;
    this.valueSum += value;
    this.judged++;
    if (grade === "MISS") {
      this.combo = 0;
      return { grade, points: 0 };
    }
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const points = Math.round(1000 * value) + Math.min(this.combo - 1, 30) * 10;
    this.score += points;
    return { grade, points };
  }

  result(): PlayResult {
    return {
      score: this.score,
      maxCombo: this.maxCombo,
      counts: { ...this.counts },
      accuracy: this.judged ? this.valueSum / this.judged : 0,
    };
  }
}
