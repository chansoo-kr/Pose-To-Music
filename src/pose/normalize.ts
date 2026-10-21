import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { FULL_BODY_JOINTS, J, LANDMARK_COUNT } from "./joints";

export interface Pt {
  x: number;
  y: number;
}

/** 관절 좌표 + visibility */
export interface Joint extends Pt {
  v: number;
}

/**
 * 정규화된 포즈.
 * - 원점: 양 엉덩이 중점
 * - 단위: 몸통 길이(어깨 중점 ↔ 엉덩이 중점)
 * - y는 아래 방향이 +, x는 카메라 원본 기준(거울 반전 전)
 */
export type NormPose = Joint[];

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** 몸 위치·크기를 나타내는 기준 (임의 좌표계에서) */
export interface Anchor {
  hip: Pt;
  torso: number;
}

export function anchorOf(points: Pt[]): Anchor {
  const hip = mid(points[J.L_HIP], points[J.R_HIP]);
  const shoulder = mid(points[J.L_SHOULDER], points[J.R_SHOULDER]);
  return { hip, torso: dist(hip, shoulder) };
}

/**
 * MediaPipe 이미지 좌표(0~1)를 정규화 포즈로 바꾼다.
 * @param aspect 비디오 가로/세로 비 — x, y 단위를 같게 맞추기 위해 사용
 */
export function normalize(lms: NormalizedLandmark[], aspect: number): NormPose | null {
  if (lms.length < LANDMARK_COUNT) return null;
  const pts = lms.map((l) => ({ x: l.x * aspect, y: l.y }));
  const { hip, torso } = anchorOf(pts);
  if (torso < 1e-3) return null;
  return lms.map((l, i) => ({
    x: (pts[i].x - hip.x) / torso,
    y: (pts[i].y - hip.y) / torso,
    v: l.visibility ?? 1,
  }));
}

/** 전신이 화면에 충분히 보이는지 */
export function isFullBodyVisible(lms: NormalizedLandmark[] | null, minVis = 0.5): boolean {
  if (!lms) return false;
  return FULL_BODY_JOINTS.every((i) => {
    const l = lms[i];
    return (l.visibility ?? 1) >= minVis && l.x > 0 && l.x < 1 && l.y > 0 && l.y < 1;
  });
}

/** 차트 저장용으로 압축 ([x, y] 소수점 3자리) */
export function packPose(p: NormPose): [number, number][] {
  return p.map((j) => [Math.round(j.x * 1000) / 1000, Math.round(j.y * 1000) / 1000]);
}

export function unpackPose(p: [number, number][]): NormPose {
  return p.map(([x, y]) => ({ x, y, v: 1 }));
}
