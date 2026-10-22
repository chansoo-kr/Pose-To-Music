import { J, LANDMARK_COUNT } from "./joints";

/** 채보에 저장되는 포즈: 33관절 [x, y] (정규화 좌표, 카메라 원본 기준 = 거울 반전 전) */
export type PackedPose = [number, number][];

/**
 * 채보 에디터에서 관절을 끌어 포즈를 고치는 순수 함수들.
 * 관절 계층(부모 → 자식)을 따라 아래 관절이 같이 움직인다.
 */

/** 손잡이로 끌 수 있는 관절 (화면에 그리는 관절과 같음) */
export const HANDLE_JOINTS = [
  J.NOSE,
  J.L_SHOULDER,
  J.R_SHOULDER,
  J.L_ELBOW,
  J.R_ELBOW,
  J.L_WRIST,
  J.R_WRIST,
  J.L_INDEX,
  J.R_INDEX,
  J.L_HIP,
  J.R_HIP,
  J.L_KNEE,
  J.R_KNEE,
  J.L_ANKLE,
  J.R_ANKLE,
  J.L_FOOT,
  J.R_FOOT,
];

/** 부모 관절. 없으면(코·어깨·엉덩이) 자유 이동 */
const PARENT: Partial<Record<number, number>> = {
  [J.L_ELBOW]: J.L_SHOULDER,
  [J.R_ELBOW]: J.R_SHOULDER,
  [J.L_WRIST]: J.L_ELBOW,
  [J.R_WRIST]: J.R_ELBOW,
  [J.L_INDEX]: J.L_WRIST,
  [J.R_INDEX]: J.R_WRIST,
  [J.L_PINKY]: J.L_WRIST,
  [J.R_PINKY]: J.R_WRIST,
  [J.L_THUMB]: J.L_WRIST,
  [J.R_THUMB]: J.R_WRIST,
  [J.L_KNEE]: J.L_HIP,
  [J.R_KNEE]: J.R_HIP,
  [J.L_ANKLE]: J.L_KNEE,
  [J.R_ANKLE]: J.R_KNEE,
  [J.L_HEEL]: J.L_ANKLE,
  [J.R_HEEL]: J.R_ANKLE,
  [J.L_FOOT]: J.L_ANKLE,
  [J.R_FOOT]: J.R_ANKLE,
};
// 얼굴 점 1~10은 코를 따라간다
for (let i = 1; i <= 10; i++) PARENT[i] = J.NOSE;

const CHILDREN: number[][] = Array.from({ length: LANDMARK_COUNT }, () => []);
for (const [child, parent] of Object.entries(PARENT)) CHILDREN[parent!].push(Number(child));

/** 이 관절 아래의 모든 관절 (자신 제외) */
export function descendants(joint: number): number[] {
  const out: number[] = [];
  const stack = [...CHILDREN[joint]];
  while (stack.length) {
    const j = stack.pop()!;
    out.push(j);
    stack.push(...CHILDREN[j]);
  }
  return out;
}

export const parentOf = (joint: number): number | undefined => PARENT[joint];

/** 편집 범위 (썸네일·미리보기에서 잘리지 않는 범위) */
export const BOUNDS = { minX: -1.7, maxX: 1.7, minY: -2.3, maxY: 2.0 };

export const clampPoint = (x: number, y: number): [number, number] => [
  Math.min(BOUNDS.maxX, Math.max(BOUNDS.minX, x)),
  Math.min(BOUNDS.maxY, Math.max(BOUNDS.minY, y)),
];

const copy = (p: PackedPose): PackedPose => p.map(([x, y]) => [x, y]);

/** 관절을 (x, y)로 옮기고, 아래 관절은 같은 만큼 평행 이동 (뼈 길이가 바뀜) */
export function moveJoint(pose: PackedPose, joint: number, x: number, y: number): PackedPose {
  const out = copy(pose);
  const dx = x - pose[joint][0];
  const dy = y - pose[joint][1];
  for (const j of [joint, ...descendants(joint)]) out[j] = [pose[j][0] + dx, pose[j][1] + dy];
  return out;
}

/**
 * 뼈 길이를 유지한 채 관절이 (x, y) 쪽을 향하도록 부모 관절을 중심으로 돌린다.
 * 아래 관절도 같은 각도로 따라 돈다. 부모가 없는 관절은 moveJoint와 같다.
 */
export function rotateJoint(pose: PackedPose, joint: number, x: number, y: number): PackedPose {
  const parent = PARENT[joint];
  if (parent === undefined) return moveJoint(pose, joint, x, y);
  const [ox, oy] = pose[parent];
  const [jx, jy] = pose[joint];
  if (Math.hypot(x - ox, y - oy) < 1e-6) return copy(pose);
  const angle = Math.atan2(y - oy, x - ox) - Math.atan2(jy - oy, jx - ox);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const out = copy(pose);
  for (const j of [joint, ...descendants(joint)]) {
    const dx = pose[j][0] - ox;
    const dy = pose[j][1] - oy;
    out[j] = [ox + dx * cos - dy * sin, oy + dx * sin + dy * cos];
  }
  return out;
}

/**
 * 다시 정규화: 엉덩이 중점 = 원점, 어깨 중점 ~ 엉덩이 중점 거리 = 1.
 * 판정이 정규화 좌표를 그대로 비교하므로 어깨·엉덩이를 옮긴 뒤에는 꼭 거친다.
 */
export function renormalize(pose: PackedPose): PackedPose {
  const hx = (pose[J.L_HIP][0] + pose[J.R_HIP][0]) / 2;
  const hy = (pose[J.L_HIP][1] + pose[J.R_HIP][1]) / 2;
  const sx = (pose[J.L_SHOULDER][0] + pose[J.R_SHOULDER][0]) / 2;
  const sy = (pose[J.L_SHOULDER][1] + pose[J.R_SHOULDER][1]) / 2;
  const torso = Math.hypot(sx - hx, sy - hy);
  if (torso < 0.1) return copy(pose); // 몸통이 거의 없으면 그대로 (망가뜨리지 않게)
  return pose.map(([x, y]) => clampPoint((x - hx) / torso, (y - hy) / torso));
}

/** 소수점 3자리로 (저장 형식과 같게) */
export const roundPose = (pose: PackedPose): PackedPose =>
  pose.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);

/** 좌우 짝 (MediaPipe 랜드마크 번호) */
const MIRROR_PAIRS: [number, number][] = [
  [1, 4],
  [2, 5],
  [3, 6],
  [7, 8],
  [9, 10],
];
for (let l = J.L_SHOULDER; l <= J.L_FOOT; l += 2) MIRROR_PAIRS.push([l, l + 1]);

/** 좌우 뒤집기: 왼쪽·오른쪽 관절을 맞바꾸고 x를 뒤집는다 */
export function mirrorPose(pose: PackedPose): PackedPose {
  const out: PackedPose = pose.map(([x, y]) => [-x, y]);
  for (const [a, b] of MIRROR_PAIRS) [out[a], out[b]] = [out[b], out[a]];
  return out;
}

export const samePose = (a: PackedPose, b: PackedPose) =>
  a.length === b.length && a.every(([x, y], i) => Math.abs(x - b[i][0]) < 1e-4 && Math.abs(y - b[i][1]) < 1e-4);
