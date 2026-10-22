import { J } from "../pose/joints";
import type { NormPose, Pt } from "../pose/normalize";
import { buildPose } from "./poses";

export type Grade = "PERFECT" | "GREAT" | "GOOD" | "MISS";
export const GRADES: Grade[] = ["PERFECT", "GREAT", "GOOD", "MISS"];

/** 판정 시각 기준 ± 이 시간(초) 안의 프레임 중 최고 점수를 쓴다 (박자 간격이 좁으면 더 줄어듦) */
export const TIMING_WINDOW = 0.3;

/** 판정 여유: 각도·거리 기준에 곱하는 배율 */
export type Leniency = "strict" | "normal" | "loose";
export const LENIENCIES: Leniency[] = ["strict", "normal", "loose"];
export const LENIENCY_LABEL: Record<Leniency, string> = { strict: "엄격", normal: "보통", loose: "여유" };
const LENIENCY_SCALE: Record<Leniency, number> = { strict: 0.8, normal: 1, loose: 1.3 };

const MIN_VISIBILITY = 0.3;

/*
 * 판정: 관절 위치 대신 "그 관절로 이어지는 뼈의 방향"을 비교한다.
 * 각도는 체형(팔 길이·어깨 폭)과 관계없고, 어깨에서 틀린 오차가 손목까지 쌓이지 않는다.
 */

/** 뼈 시작점: 관절 번호 또는 중점 */
type From = number | "hip" | "shoulder";

interface JudgeBone {
  from: From;
  /** 보통 화면상 길이 (몸통 = 1) — 이보다 훨씬 짧으면 카메라 쪽을 가리키는 것 */
  len: number;
  /** 짧은 뼈: 인식이 흔들려서 기준을 넉넉하게 */
  short?: boolean;
}

const JUDGE_BONES: Record<number, JudgeBone> = {
  [J.L_ELBOW]: { from: J.L_SHOULDER, len: 0.58 },
  [J.R_ELBOW]: { from: J.R_SHOULDER, len: 0.58 },
  [J.L_WRIST]: { from: J.L_ELBOW, len: 0.5 },
  [J.R_WRIST]: { from: J.R_ELBOW, len: 0.5 },
  [J.L_INDEX]: { from: J.L_WRIST, len: 0.15, short: true },
  [J.R_INDEX]: { from: J.R_WRIST, len: 0.15, short: true },
  [J.L_KNEE]: { from: J.L_HIP, len: 0.78 },
  [J.R_KNEE]: { from: J.R_HIP, len: 0.78 },
  [J.L_ANKLE]: { from: J.L_KNEE, len: 0.78 },
  [J.R_ANKLE]: { from: J.R_KNEE, len: 0.78 },
  [J.L_FOOT]: { from: J.L_ANKLE, len: 0.13, short: true },
  [J.R_FOOT]: { from: J.R_ANKLE, len: 0.13, short: true },
  [J.L_SHOULDER]: { from: "hip", len: 1.06 },
  [J.R_SHOULDER]: { from: "hip", len: 1.06 },
  [J.L_HIP]: { from: "shoulder", len: 1.02 },
  [J.R_HIP]: { from: "shoulder", len: 1.02 },
  [J.NOSE]: { from: "shoulder", len: 0.33 },
};

/** 각도 기준(도): 이 안이면 만점, ZERO 이상이면 0점 */
const ANGLE_PERFECT = 15;
const ANGLE_ZERO = 60;
const SHORT_PERFECT = 25;
const SHORT_ZERO = 75;
/** 뼈가 보통 길이의 이 비율보다 짧게 보이면 방향을 믿을 수 없다 → 위치로 판정 */
const FORESHORTEN = 0.4;
/** 위치 판정 기준 (몸통 길이 단위) */
const DIST_PERFECT = 0.2;
const DIST_ZERO = 0.7;

/** 0~1, 가운데가 볼록한 곡선 — "거의 맞음"에 점수를 더 준다 */
function falloff(value: number, perfect: number, zero: number) {
  const t = Math.min(1, Math.max(0, (zero - value) / (zero - perfect)));
  return t * t * (3 - 2 * t);
}

function fromPoint(p: NormPose, from: From): Pt & { v: number } {
  if (typeof from === "number") return p[from];
  const [a, b] = from === "hip" ? [p[J.L_HIP], p[J.R_HIP]] : [p[J.L_SHOULDER], p[J.R_SHOULDER]];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) };
}

function boneAngle(p: NormPose, joint: number, bone: JudgeBone) {
  const f = fromPoint(p, bone.from);
  return Math.atan2(p[joint].y - f.y, p[joint].x - f.x);
}

const angleDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) * (180 / Math.PI);
  return d > 180 ? 360 - d : d;
};

/*
 * 가만히 서 있어도 점수가 나오지 않게: 목표 포즈에서 "차렷"과 다르게 움직인 관절에 무게를 더 준다.
 * (팔 동작 포즈에서 어깨·무릎은 차렷 그대로라, 같은 무게면 서 있기만 해도 절반은 맞는다)
 */
const NEUTRAL = buildPose({ name: "차렷", lArm: [5, 5], rArm: [5, 5] });
const NEUTRAL_ANGLE: Record<number, number> = Object.fromEntries(
  Object.entries(JUDGE_BONES).map(([j, bone]) => [j, boneAngle(NEUTRAL, Number(j), bone)]),
);
/** 차렷 그대로인 관절의 무게 (움직인 관절 = 1) */
const STILL_WEIGHT = 0.1;
const MOVED_FROM = 10;
const MOVED_TO = 30;

/** 목표 포즈에서 이 관절이 얼마나 "움직인" 관절인지 (STILL_WEIGHT ~ 1) */
export function jointWeight(target: NormPose, joint: number): number {
  const bone = JUDGE_BONES[joint];
  if (!bone) return 1;
  const f = fromPoint(target, bone.from);
  // 카메라 쪽을 가리키는 뼈는 차렷이 아니다
  if (Math.hypot(target[joint].x - f.x, target[joint].y - f.y) < bone.len * FORESHORTEN) return 1;
  const moved = 1 - falloff(angleDiff(boneAngle(target, joint, bone), NEUTRAL_ANGLE[joint]), MOVED_FROM, MOVED_TO);
  return STILL_WEIGHT + (1 - STILL_WEIGHT) * moved;
}

/** 관절 하나의 판정 내역 (디버그 기록에도 씀) */
export interface JointJudge {
  joint: number;
  /** 뼈 방향 차이(도). 위치로 판정했으면 null */
  angle: number | null;
  /** 관절 위치 거리 (몸통 길이 단위) */
  dist: number;
  score: number;
}

export function judgeJoint(target: NormPose, actual: NormPose, joint: number, leniency: Leniency = "normal"): JointJudge {
  const scale = LENIENCY_SCALE[leniency];
  const ta = target[joint];
  const aa = actual[joint];
  const dist = Math.hypot(aa.x - ta.x, aa.y - ta.y);
  const bone = JUDGE_BONES[joint];
  const tf = bone ? fromPoint(target, bone.from) : null;
  const af = bone ? fromPoint(actual, bone.from) : null;
  if (aa.v < MIN_VISIBILITY || (af && af.v < MIN_VISIBILITY)) return { joint, angle: null, dist, score: 0 };

  const byDistance = () => ({ joint, angle: null, dist, score: falloff(dist, DIST_PERFECT * scale, DIST_ZERO * scale) });
  if (!bone || !tf || !af) return byDistance();

  const tx = ta.x - tf.x;
  const ty = ta.y - tf.y;
  const ax = aa.x - af.x;
  const ay = aa.y - af.y;
  const min = bone.len * FORESHORTEN;
  if (Math.hypot(tx, ty) < min || Math.hypot(ax, ay) < min) return byDistance();

  const angle = angleDiff(Math.atan2(ty, tx), Math.atan2(ay, ax));
  const [perfect, zero] = bone.short ? [SHORT_PERFECT, SHORT_ZERO] : [ANGLE_PERFECT, ANGLE_ZERO];
  return { joint, angle, dist, score: falloff(angle, perfect * scale, zero * scale) };
}

/** 관절별 점수(0~1) */
export function jointScores(target: NormPose, actual: NormPose, joints: number[], leniency: Leniency = "normal"): number[] {
  return joints.map((j) => judgeJoint(target, actual, j, leniency).score);
}

/** 포즈 정확도 0~1: 관절 점수의 가중 평균 (움직인 관절일수록 무게가 큼) */
export function poseAccuracy(target: NormPose, actual: NormPose, joints: number[], leniency: Leniency = "normal"): number {
  let sum = 0;
  let total = 0;
  for (const j of joints) {
    const w = jointWeight(target, j);
    sum += w * judgeJoint(target, actual, j, leniency).score;
    total += w;
  }
  return total ? sum / total : 0;
}

/** 정확도 × 타이밍 가중치 (박자에서 멀수록 최대 10% 감점) */
export function timedValue(accuracy: number, dt: number, window = TIMING_WINDOW) {
  return accuracy * (1 - 0.1 * Math.min(1, Math.abs(dt) / window));
}

export function gradeOf(value: number): Grade {
  if (value >= 0.8) return "PERFECT";
  if (value >= 0.6) return "GREAT";
  if (value >= 0.4) return "GOOD";
  return "MISS";
}

// ---- v3 판정 (다시 채점 비교용) ----

export const legacy = {
  jointScores(target: NormPose, actual: NormPose, joints: number[]): number[] {
    return joints.map((j) => {
      const a = actual[j];
      if (a.v < MIN_VISIBILITY) return 0;
      const d = Math.hypot(a.x - target[j].x, a.y - target[j].y);
      return Math.min(1, Math.max(0, (0.55 - d) / (0.55 - 0.12)));
    });
  },
  poseAccuracy(target: NormPose, actual: NormPose, joints: number[]): number {
    const s = legacy.jointScores(target, actual, joints);
    return s.reduce((a, b) => a + b, 0) / s.length;
  },
  timedValue(accuracy: number, dt: number, window = TIMING_WINDOW) {
    return accuracy * (1 - 0.25 * Math.min(1, Math.abs(dt) / window));
  },
  gradeOf(value: number): Grade {
    if (value >= 0.85) return "PERFECT";
    if (value >= 0.7) return "GREAT";
    if (value >= 0.5) return "GOOD";
    return "MISS";
  },
};

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
