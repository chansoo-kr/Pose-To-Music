import { POSE_LIBRARY, buildPose } from "../game/poses";
import { assert, near, test } from "../testing";
import { descendants, mirrorPose, moveJoint, renormalize, rotateJoint, samePose, type PackedPose } from "./edit";
import { J } from "./joints";
import { packPose } from "./normalize";

export { run as __run } from "../testing";

const pose = (name: string): PackedPose => packPose(buildPose(POSE_LIBRARY.find((p) => p.name === name)!));
const dist = (p: PackedPose, a: number, b: number) => Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1]);

test("팔꿈치 아래는 손목·손 전부", () => {
  const d = descendants(J.L_ELBOW).sort((a, b) => a - b);
  assert(JSON.stringify(d) === JSON.stringify([J.L_WRIST, J.L_PINKY, J.L_INDEX, J.L_THUMB].sort((a, b) => a - b)), String(d));
});

test("돌리기: 뼈 길이 유지, 아래 관절도 같이 돈다", () => {
  const p = pose("T자");
  const out = rotateJoint(p, J.L_ELBOW, p[J.L_SHOULDER][0], p[J.L_SHOULDER][1] - 1); // 위로
  near(dist(out, J.L_SHOULDER, J.L_ELBOW), dist(p, J.L_SHOULDER, J.L_ELBOW), 1e-9, "윗팔");
  near(dist(out, J.L_ELBOW, J.L_WRIST), dist(p, J.L_ELBOW, J.L_WRIST), 1e-9, "아래팔");
  near(out[J.L_ELBOW][0], p[J.L_SHOULDER][0], 1e-9, "팔꿈치가 어깨 바로 위");
  assert(out[J.L_WRIST][1] < out[J.L_ELBOW][1], "손목이 팔꿈치보다 위");
  assert(samePose([out[J.R_WRIST]], [p[J.R_WRIST]]), "반대쪽 팔은 그대로");
});

test("옮기기: 관절은 커서로, 아래 관절은 평행 이동", () => {
  const p = pose("T자");
  const out = moveJoint(p, J.L_WRIST, 1, 0);
  near(out[J.L_WRIST][0], 1);
  near(out[J.L_WRIST][1], 0);
  near(out[J.L_INDEX][0] - out[J.L_WRIST][0], p[J.L_INDEX][0] - p[J.L_WRIST][0], 1e-9);
  assert(samePose([out[J.L_ELBOW]], [p[J.L_ELBOW]]), "팔꿈치는 그대로");
});

test("어깨는 자유 이동이고 팔 전체가 따라온다", () => {
  const p = pose("T자");
  const out = rotateJoint(p, J.L_SHOULDER, p[J.L_SHOULDER][0] + 0.1, p[J.L_SHOULDER][1]);
  near(out[J.L_WRIST][0] - p[J.L_WRIST][0], 0.1, 1e-9);
});

test("다시 정규화: 엉덩이 중점 원점, 몸통 1", () => {
  const p = moveJoint(moveJoint(pose("만세"), J.L_HIP, 0.4, 0.3), J.R_HIP, -0.1, 0.3);
  const n = renormalize(p);
  near((n[J.L_HIP][0] + n[J.R_HIP][0]) / 2, 0, 1e-9);
  near((n[J.L_HIP][1] + n[J.R_HIP][1]) / 2, 0, 1e-9);
  const sx = (n[J.L_SHOULDER][0] + n[J.R_SHOULDER][0]) / 2;
  const sy = (n[J.L_SHOULDER][1] + n[J.R_SHOULDER][1]) / 2;
  near(Math.hypot(sx, sy), 1, 1e-9);
});

test("이미 정규화된 포즈는 그대로", () => {
  const p = pose("별");
  assert(samePose(renormalize(p), p));
});

test("좌우 뒤집기 두 번이면 원래대로, 한 번이면 왼손 위 ↔ 오른손 위", () => {
  const p = pose("왼손 위");
  assert(samePose(mirrorPose(mirrorPose(p)), p), "두 번");
  assert(samePose(mirrorPose(p), pose("오른손 위")), "한 번");
});
