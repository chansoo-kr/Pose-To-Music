// MediaPipe Pose 33개 랜드마크 인덱스
export const J = {
  NOSE: 0,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_PINKY: 17,
  R_PINKY: 18,
  L_INDEX: 19,
  R_INDEX: 20,
  L_THUMB: 21,
  R_THUMB: 22,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
  L_HEEL: 29,
  R_HEEL: 30,
  L_FOOT: 31,
  R_FOOT: 32,
} as const;

export const LANDMARK_COUNT = 33;

export type Difficulty = "easy" | "normal" | "hard" | "expert";

const EASY = [J.L_WRIST, J.R_WRIST, J.L_ELBOW, J.R_ELBOW];
const NORMAL = [...EASY, J.L_SHOULDER, J.R_SHOULDER, J.L_KNEE, J.R_KNEE];
const HARD = [...NORMAL, J.L_HIP, J.R_HIP, J.L_ANKLE, J.R_ANKLE];
const EXPERT = [...HARD, J.NOSE, J.L_INDEX, J.R_INDEX, J.L_FOOT, J.R_FOOT];

export const DIFFICULTY_JOINTS: Record<Difficulty, number[]> = {
  easy: EASY,
  normal: NORMAL,
  hard: HARD,
  expert: EXPERT,
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "쉬움",
  normal: "보통",
  hard: "어려움",
  expert: "최고",
};

export const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard", "expert"];

// 화면에 그릴 뼈대 (얼굴 세부는 생략)
export const BONES: [number, number][] = [
  [J.L_SHOULDER, J.R_SHOULDER],
  [J.L_SHOULDER, J.L_ELBOW],
  [J.L_ELBOW, J.L_WRIST],
  [J.L_WRIST, J.L_INDEX],
  [J.R_SHOULDER, J.R_ELBOW],
  [J.R_ELBOW, J.R_WRIST],
  [J.R_WRIST, J.R_INDEX],
  [J.L_SHOULDER, J.L_HIP],
  [J.R_SHOULDER, J.R_HIP],
  [J.L_HIP, J.R_HIP],
  [J.L_HIP, J.L_KNEE],
  [J.L_KNEE, J.L_ANKLE],
  [J.L_ANKLE, J.L_FOOT],
  [J.R_HIP, J.R_KNEE],
  [J.R_KNEE, J.R_ANKLE],
  [J.R_ANKLE, J.R_FOOT],
];

export const DISPLAY_JOINTS = [
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

// 전신 인식 체크에 쓰는 관절
export const FULL_BODY_JOINTS = [
  J.NOSE,
  J.L_SHOULDER,
  J.R_SHOULDER,
  J.L_WRIST,
  J.R_WRIST,
  J.L_HIP,
  J.R_HIP,
  J.L_ANKLE,
  J.R_ANKLE,
];
