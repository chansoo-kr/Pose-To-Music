import type { Song } from "../data/library";
import type { Difficulty } from "../pose/joints";
import type { Chart } from "./chart";
import type { PlayResult } from "./scoring";

export interface Player {
  id: string;
  name: string;
  color: string;
  /** 이 플레이어가 후보로 낸 곡 */
  candidate?: Song;
  /** 이 플레이어가 녹화한 채보 (프리스타일) */
  chart?: Chart;
  /** 따라 할 채보를 만든 플레이어 id (프리스타일) */
  assignedFrom?: string;
  result?: PlayResult;
}

export interface Match {
  players: Player[];
  song?: Song;
  /** 모두가 플레이할 채보 (기본 모드) */
  chart?: Chart;
  difficulty: Difficulty;
}

export const PLAYER_COLORS = ["#ff5a36", "#5b9cf0", "#e0b44c", "#5fbf7f", "#a586e0", "#d97aa8"];

export function newMatch(): Match {
  return {
    players: [
      { id: crypto.randomUUID(), name: "플레이어 1", color: PLAYER_COLORS[0] },
      { id: crypto.randomUUID(), name: "플레이어 2", color: PLAYER_COLORS[1] },
    ],
    difficulty: "normal",
  };
}

/**
 * 자기 자신을 받지 않도록 채보를 랜덤 교환한다 (derangement).
 * @returns 받는 플레이어 id → 채보를 만든 플레이어 id
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
