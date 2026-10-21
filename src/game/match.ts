import type { Song } from "../audio/songs";
import type { Difficulty } from "../pose/joints";
import type { Chart } from "./chart";
import type { PlayResult } from "./scoring";

export interface Player {
  id: string;
  name: string;
  color: string;
  /** 이 플레이어가 후보로 낸 곡 */
  candidate?: Song;
  /** 이 플레이어가 녹화한 안무 */
  chart?: Chart;
  /** 따라 할 안무를 만든 플레이어 id */
  assignedFrom?: string;
  result?: PlayResult;
}

export interface Match {
  players: Player[];
  song?: Song;
  difficulty: Difficulty;
  /** 몇 박마다 포즈 하나 */
  interval: number;
}

export const PLAYER_COLORS = ["#ff4d8d", "#3ec5ff", "#ffd23f", "#7cff6b", "#b388ff", "#ff9f43"];

export function newMatch(): Match {
  return {
    players: [
      { id: crypto.randomUUID(), name: "플레이어 1", color: PLAYER_COLORS[0] },
      { id: crypto.randomUUID(), name: "플레이어 2", color: PLAYER_COLORS[1] },
    ],
    difficulty: "normal",
    interval: 2,
  };
}

/**
 * 자기 자신을 받지 않도록 안무를 랜덤 교환한다 (derangement).
 * @returns 받는 플레이어 id → 안무를 만든 플레이어 id
 */
export function assignCharts(players: Player[]): Map<string, string> {
  const ids = players.map((p) => p.id);
  // Sattolo 알고리즘: 하나의 큰 순환 순열을 만들어 고정점이 없다
  const perm = [...ids];
  for (let i = perm.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * i);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const map = new Map<string, string>();
  ids.forEach((id, i) => map.set(id, perm[i]));
  return map;
}

export function playerById(match: Match, id: string | undefined) {
  return match.players.find((p) => p.id === id);
}
