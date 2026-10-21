import { J, LANDMARK_COUNT } from "../pose/joints";
import type { NormPose, Pt } from "../pose/normalize";

/**
 * 에디터 "포즈 라이브러리로 채우기"용 포즈 모음.
 * 정규화 좌표계(엉덩이 중점 원점, 몸통 길이 = 1)에서 관절 각도로 포즈를 만든다.
 *
 * 각도(도): 0 = 아래, 90 = 몸 바깥쪽 수평, 180 = 위, 음수 = 몸 안쪽.
 * 카메라 원본 좌표 기준이라 사람의 왼쪽(L)이 +x 쪽이다.
 */
interface PoseSpec {
  name: string;
  lArm: [number, number]; // [윗팔, 아래팔]
  rArm: [number, number];
  lLeg?: [number, number]; // [허벅지, 정강이]
  rLeg?: [number, number];
}

// MediaPipe 랜드마크 기준 실측 비율 (몸통 = 1)
const UPPER_ARM = 0.58;
const FOREARM = 0.5;
const HAND = 0.15;
const THIGH = 0.78;
const SHIN = 0.78;

function dir(side: 1 | -1, deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  return { x: side * Math.sin(r), y: Math.cos(r) };
}

const add = (p: Pt, d: Pt, len: number): Pt => ({ x: p.x + d.x * len, y: p.y + d.y * len });

export function buildPose(spec: PoseSpec): NormPose {
  const pts: Pt[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0 }));

  const nose = { x: 0, y: -1.33 };
  pts[J.NOSE] = nose;
  for (let i = 1; i <= 10; i++) {
    const side = i <= 3 || i === 7 || i === 9 ? 1 : -1;
    pts[i] = { x: nose.x + side * (i >= 7 && i <= 8 ? 0.15 : 0.06), y: nose.y + (i >= 9 ? 0.07 : -0.04) };
  }

  const limbs = [
    { side: 1 as const, arm: spec.lArm, leg: spec.lLeg ?? [4, 0], s: J.L_SHOULDER, h: J.L_HIP },
    { side: -1 as const, arm: spec.rArm, leg: spec.rLeg ?? [4, 0], s: J.R_SHOULDER, h: J.R_HIP },
  ];
  for (const { side, arm, leg, s, h } of limbs) {
    const shoulder = { x: side * 0.36, y: -1 };
    const elbow = add(shoulder, dir(side, arm[0]), UPPER_ARM);
    const wrist = add(elbow, dir(side, arm[1]), FOREARM);
    const hand = add(wrist, dir(side, arm[1]), HAND);
    const hip = { x: side * 0.2, y: 0 };
    const knee = add(hip, dir(side, leg[0]), THIGH);
    const ankle = add(knee, dir(side, leg[1]), SHIN);

    const o = side === 1 ? 0 : 1; // 오른쪽 인덱스는 왼쪽 + 1
    pts[s] = shoulder;
    pts[J.L_ELBOW + o] = elbow;
    pts[J.L_WRIST + o] = wrist;
    pts[J.L_INDEX + o] = hand;
    pts[J.L_PINKY + o] = add(hand, { x: side, y: 0 }, 0.04);
    pts[J.L_THUMB + o] = add(wrist, { x: -side, y: 0 }, 0.06);
    pts[h] = hip;
    pts[J.L_KNEE + o] = knee;
    pts[J.L_ANKLE + o] = ankle;
    pts[J.L_HEEL + o] = { x: ankle.x, y: ankle.y + 0.05 };
    pts[J.L_FOOT + o] = { x: ankle.x + side * 0.05, y: ankle.y + 0.12 };
  }

  return pts.map((p) => ({ ...p, v: 1 }));
}

export const POSE_LIBRARY: PoseSpec[] = [
  { name: "T자", lArm: [90, 90], rArm: [90, 90] },
  { name: "Y자", lArm: [150, 150], rArm: [150, 150] },
  { name: "만세", lArm: [175, 175], rArm: [175, 175] },
  { name: "왼손 위", lArm: [170, 170], rArm: [12, 12] },
  { name: "오른손 위", lArm: [12, 12], rArm: [170, 170] },
  { name: "근육 자랑", lArm: [90, 180], rArm: [90, 180] },
  { name: "허리에 손", lArm: [45, -50], rArm: [45, -50] },
  { name: "디스코 (왼쪽)", lArm: [140, 140], rArm: [25, 25] },
  { name: "디스코 (오른쪽)", lArm: [25, 25], rArm: [140, 140] },
  { name: "기마 자세", lArm: [90, 180], rArm: [90, 180], lLeg: [35, 0], rLeg: [35, 0] },
  { name: "별", lArm: [135, 135], rArm: [135, 135], lLeg: [28, 28], rLeg: [28, 28] },
  { name: "왼다리 옆으로", lArm: [90, 90], rArm: [90, 90], lLeg: [45, 45] },
  { name: "오른다리 옆으로", lArm: [90, 90], rArm: [90, 90], rLeg: [45, 45] },
  { name: "왼손 흔들기", lArm: [90, 160], rArm: [10, 10] },
  { name: "오른손 흔들기", lArm: [10, 10], rArm: [90, 160] },
  { name: "팔짱", lArm: [30, -100], rArm: [30, -100] },
  { name: "갈매기", lArm: [120, 60], rArm: [120, 60], lLeg: [20, 20], rLeg: [20, 20] },
];
