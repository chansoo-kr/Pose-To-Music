/** 이 기기의 벽시계 (ms). performance 기반이라 시스템 시간 변경에 흔들리지 않는다 */
export const clockNow = () => performance.timeOrigin + performance.now();

export interface ClockSample {
  /** 요청 보낸 시각 (내 시계) */
  t0: number;
  /** 상대가 응답한 시각 (상대 시계) */
  t1: number;
  /** 응답 받은 시각 (내 시계) */
  t2: number;
}

/**
 * NTP 방식 시계 차이 추정: RTT가 가장 짧은 측정값을 쓴다.
 * @returns offset — 상대 시계 = 내 시계 + offset
 */
export function clockOffset(samples: ClockSample[]): { offset: number; rtt: number } | null {
  let best: ClockSample | null = null;
  for (const s of samples) if (!best || s.t2 - s.t0 < best.t2 - best.t0) best = s;
  if (!best) return null;
  return { offset: best.t1 - (best.t0 + best.t2) / 2, rtt: best.t2 - best.t0 };
}

/** request()로 상대 시각을 n번 받아 offset을 구한다 */
export async function measureOffset(ask: () => Promise<unknown>, n = 5) {
  const samples: ClockSample[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = clockNow();
    try {
      const t1 = await ask();
      const t2 = clockNow();
      if (typeof t1 === "number" && Number.isFinite(t1)) samples.push({ t0, t1, t2 });
    } catch {
      /* 시간 초과 — 다음 측정 */
    }
  }
  return clockOffset(samples);
}
