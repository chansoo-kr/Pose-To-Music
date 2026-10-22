import { DIFFICULTY_JOINTS, J } from "../pose/joints";
import type { NormPose, Pt } from "../pose/normalize";
import { assert, near, test } from "../testing";
import { POSE_LIBRARY, buildPose } from "./poses";
import { gradeOf, judgeJoint, legacy, poseAccuracy } from "./scoring";

export { run as __run } from "../testing";

const pose = (name: string) => buildPose(POSE_LIBRARY.find((p) => p.name === name)!);
const EXPERT = DIFFICULTY_JOINTS.expert;
const EASY = DIFFICULTY_JOINTS.easy;

/** 부모 → 자식 (체형 바꾸기·팔 돌리기에 씀) */
const CHAINS: [number, number][] = [
  [J.L_SHOULDER, J.L_ELBOW],
  [J.L_ELBOW, J.L_WRIST],
  [J.L_WRIST, J.L_INDEX],
  [J.R_SHOULDER, J.R_ELBOW],
  [J.R_ELBOW, J.R_WRIST],
  [J.R_WRIST, J.R_INDEX],
  [J.L_HIP, J.L_KNEE],
  [J.L_KNEE, J.L_ANKLE],
  [J.L_ANKLE, J.L_FOOT],
  [J.R_HIP, J.R_KNEE],
  [J.R_KNEE, J.R_ANKLE],
  [J.R_ANKLE, J.R_FOOT],
];

/** 각도는 그대로 두고 뼈 길이만 바꾼 포즈 (팔 ×arm, 다리 ×leg, 어깨 폭 ×width) */
function reshape(p: NormPose, arm: number, leg: number, width: number): NormPose {
  const out = p.map((j) => ({ ...j }));
  for (const s of [J.L_SHOULDER, J.R_SHOULDER]) out[s].x = p[s].x * width;
  for (const [a, b] of CHAINS) {
    const k = a === J.L_HIP || a === J.R_HIP || a === J.L_KNEE || a === J.R_KNEE || a === J.L_ANKLE || a === J.R_ANKLE ? leg : arm;
    out[b].x = out[a].x + (p[b].x - p[a].x) * k;
    out[b].y = out[a].y + (p[b].y - p[a].y) * k;
  }
  return out;
}

/** 팔 전체를 어깨 기준으로 deg만큼 돌린다 (양팔 모두 몸 바깥쪽 위로) */
function rotateArms(p: NormPose, deg: number): NormPose {
  const out = p.map((j) => ({ ...j }));
  for (const [s, side] of [
    [J.L_SHOULDER, 1],
    [J.R_SHOULDER, -1],
  ] as const) {
    const r = ((deg * Math.PI) / 180) * -side;
    const o: Pt = p[s];
    for (const j of s === J.L_SHOULDER ? [J.L_ELBOW, J.L_WRIST, J.L_INDEX] : [J.R_ELBOW, J.R_WRIST, J.R_INDEX]) {
      const dx = p[j].x - o.x;
      const dy = p[j].y - o.y;
      out[j].x = o.x + dx * Math.cos(r) - dy * Math.sin(r);
      out[j].y = o.y + dx * Math.sin(r) + dy * Math.cos(r);
    }
  }
  return out;
}

test("같은 포즈는 만점", () => {
  for (const spec of POSE_LIBRARY) near(poseAccuracy(buildPose(spec), buildPose(spec), EXPERT), 1, 1e-9, spec.name);
});

test("체형만 다르면 (각도 같음) 거의 만점", () => {
  for (const spec of POSE_LIBRARY) {
    const target = buildPose(spec);
    const player = reshape(target, 1.15, 0.9, 0.85);
    const acc = poseAccuracy(target, player, EXPERT);
    assert(acc >= 0.95, `${spec.name}: ${acc.toFixed(3)} (v3: ${legacy.poseAccuracy(target, player, EXPERT).toFixed(3)})`);
  }
});

test("팔을 어깨에서 25° 틀리면 GREAT 이상 (v3는 MISS)", () => {
  const target = pose("T자");
  const player = rotateArms(target, 25);
  const acc = poseAccuracy(target, player, EASY);
  assert(gradeOf(acc) === "PERFECT" || gradeOf(acc) === "GREAT", `새 판정 ${acc.toFixed(3)}`);
  assert(legacy.gradeOf(legacy.poseAccuracy(target, player, EASY)) === "MISS", "v3 판정이 MISS가 아님");
});

test("팔을 반대로 들면 MISS", () => {
  assert(gradeOf(poseAccuracy(pose("왼손 위"), pose("오른손 위"), EASY)) === "MISS");
  assert(gradeOf(poseAccuracy(pose("만세"), pose("팔짱"), EASY)) === "MISS");
});

test("각도 오차가 클수록 점수가 줄어든다", () => {
  const target = pose("T자");
  let last = 2;
  for (const deg of [0, 10, 20, 30, 40, 50, 60, 70]) {
    const acc = poseAccuracy(target, rotateArms(target, deg), EASY);
    assert(acc <= last + 1e-9, `${deg}°: ${acc} > ${last}`);
    last = acc;
  }
  near(last, 0, 1e-9, "70°");
});

test("안 보이는 관절은 0점", () => {
  const target = pose("T자");
  const player = target.map((j, i) => ({ ...j, v: i === J.L_WRIST ? 0.1 : 1 }));
  near(judgeJoint(target, player, J.L_WRIST).score, 0);
});

test("카메라 쪽을 가리키는 뼈는 위치로 판정", () => {
  const target = pose("T자");
  // 왼팔 아래팔을 카메라 쪽으로: 손목이 팔꿈치와 거의 겹침
  const front = target.map((j) => ({ ...j }));
  front[J.L_WRIST] = { ...front[J.L_ELBOW], x: front[J.L_ELBOW].x + 0.05 };
  const r = judgeJoint(front, front, J.L_WRIST);
  assert(r.angle === null, "각도로 판정함");
  near(r.score, 1);
});

test("판정 여유: 엄격 ≤ 보통 ≤ 여유", () => {
  const target = pose("Y자");
  const player = rotateArms(target, 30);
  const [s, n, l] = (["strict", "normal", "loose"] as const).map((x) => poseAccuracy(target, player, EASY, x));
  assert(s <= n && n <= l && s < l, `${s} ${n} ${l}`);
});

test("가만히 서 있기: 모든 난이도에서 대부분 MISS, PERFECT는 없음", () => {
  const stand = buildPose({ name: "차렷", lArm: [5, 5], rArm: [5, 5] });
  for (const d of ["easy", "normal", "hard", "expert"] as const) {
    const grades = POSE_LIBRARY.map((spec) => gradeOf(poseAccuracy(buildPose(spec), stand, DIFFICULTY_JOINTS[d])));
    const miss = grades.filter((g) => g === "MISS").length;
    assert(miss / grades.length >= 0.7 && !grades.includes("PERFECT"), `${d}: ${grades.map((g) => g[0]).join("")}`);
  }
});

test("목표가 차렷이면 모든 관절이 같은 무게 (서 있으면 만점)", () => {
  const stand = buildPose({ name: "차렷", lArm: [5, 5], rArm: [5, 5] });
  near(poseAccuracy(stand, stand, EXPERT), 1, 1e-9);
});
