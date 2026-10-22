import { getRelaySockets } from "trystero";

export interface RelayStatus {
  /** 연결된 릴레이 수 */
  open: number;
  /** 연결하려는 릴레이 수 (아직 방에 안 들어갔으면 0) */
  total: number;
}

/** 시그널링 릴레이 연결 상태 (방 목록·대기실 표시용) */
export function relayStatus(): RelayStatus {
  const sockets = Object.values((getRelaySockets as () => Record<string, WebSocket>)() ?? {});
  return { open: sockets.filter((s) => s.readyState === WebSocket.OPEN).length, total: sockets.length };
}

/** 표시용 한 줄 + 상태 클래스 */
export function relayText(s: RelayStatus): { text: string; cls: "ok" | "warn" | "bad" } {
  if (!s.total) return { text: "릴레이 연결 중…", cls: "warn" };
  if (!s.open) return { text: `릴레이 0/${s.total} 연결됨`, cls: "bad" };
  return { text: `릴레이 ${s.open}/${s.total} 연결됨`, cls: s.open * 2 >= s.total ? "ok" : "warn" };
}
