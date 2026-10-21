/** 박자 간격이 이보다 짧으면 포즈를 바꾸기 빠듯하다 (에디터 경고) */
export const MIN_GAP = 0.6;

/** 첫 박자 전 카운트다운(초) */
export const COUNTDOWN_SEC = 3;

/**
 * 판정 윈도우: 기본값과 이웃 박자 간격의 절반 중 작은 값 → 윈도우끼리 겹치지 않는다.
 * @param times 오름차순 판정 시각
 */
export function judgeWindows(times: number[], base: number): number[] {
  return times.map((t, i) => {
    const prev = i > 0 ? t - times[i - 1] : Infinity;
    const next = i < times.length - 1 ? times[i + 1] - t : Infinity;
    return Math.min(base, prev / 2, next / 2);
  });
}

/** 가장 짧은 박자 간격 (박자가 2개 미만이면 Infinity) */
export function minGap(beats: number[]): number {
  let m = Infinity;
  for (let i = 1; i < beats.length; i++) m = Math.min(m, beats[i] - beats[i - 1]);
  return m;
}

/**
 * 게임 재생 구간: 첫 박자 4초 전부터 마지막 박자 2초 뒤까지.
 * 첫 박자가 너무 앞이면 무음 대기(leadIn)를 붙여 카운트다운 시간을 확보한다.
 */
export function playRange(times: number[], duration: number) {
  const first = times[0] ?? 0;
  const last = times[times.length - 1] ?? 0;
  const PRE = COUNTDOWN_SEC + 1;
  const from = Math.max(0, first - PRE);
  return {
    from,
    leadIn: Math.max(0.3, from - (first - PRE)),
    end: Math.min(duration, last + 2),
  };
}

/**
 * 일정 간격 박자 생성 (에디터 "그리드로 채우기")
 * @param every 몇 박마다 하나
 */
export function gridBeats(bpm: number, start: number, end: number, every: number): number[] {
  const step = (60 / bpm) * every;
  const out: number[] = [];
  if (!(step > 0.05)) return out;
  for (let t = start; t <= end + 1e-6; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}

/**
 * 간단한 BPM / 첫 박 위치 추정 (onset envelope 자기상관).
 * 정확하지 않을 수 있으니 UI에서 수동 보정을 함께 제공한다.
 */
export function detectTempo(buffer: AudioBuffer): { bpm: number; offset: number } {
  const sr = buffer.sampleRate;
  const maxLen = Math.min(buffer.length, sr * 90);
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;

  const hop = 512;
  const frames = Math.floor(maxLen / hop);
  const fps = sr / hop;

  // 프레임별 로그 에너지: 전대역(1차 차분으로 고역 강조) + 저역(킥 위주, 박 위치 찾기용)
  const energy = new Float32Array(frames);
  const lowEnergy = new Float32Array(frames);
  const alpha = 1 - Math.exp((-2 * Math.PI * 150) / sr);
  let prev = 0;
  let low = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    let lowSum = 0;
    for (let i = f * hop, end = i + hop; i < end; i++) {
      const s = (ch0[i] + ch1[i]) * 0.5;
      const d = s - prev;
      prev = s;
      sum += d * d;
      low += alpha * (s - low);
      lowSum += low * low;
    }
    energy[f] = Math.log(1e-6 + sum);
    lowEnergy[f] = Math.log(1e-6 + lowSum);
  }

  // onset: 에너지 상승분 (평균 제거)
  const onsetOf = (e: Float32Array) => {
    const o = new Float32Array(frames);
    for (let f = 1; f < frames; f++) o[f] = Math.max(0, e[f] - e[f - 1]);
    let mean = 0;
    for (const v of o) mean += v;
    mean /= frames;
    for (let f = 0; f < frames; f++) o[f] -= mean;
    return o;
  };
  const onset = onsetOf(energy);
  const lowOnset = onsetOf(lowEnergy);

  const autocorr = (lag: number) => {
    let r = 0;
    for (let f = 0; f + lag < frames; f++) r += onset[f] * onset[f + lag];
    return r / (frames - lag);
  };

  const minLag = Math.floor((fps * 60) / 180);
  const maxLag = Math.ceil((fps * 60) / 70);
  const r = new Float32Array(maxLag * 2 + 2);
  for (let lag = minLag; lag <= Math.min(maxLag * 2, frames - 1); lag++) r[lag] = autocorr(lag);

  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const score = r[lag] + 0.5 * (r[lag * 2] ?? 0);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  // 포물선 보간으로 소수 lag 추정
  const a = r[bestLag - 1] ?? 0;
  const b = r[bestLag];
  const c = r[bestLag + 1] ?? 0;
  const denom = a - 2 * b + c;
  const lag = denom !== 0 ? bestLag + (0.5 * (a - c)) / denom : bestLag;

  let bpm = (60 * fps) / lag;
  while (bpm < 80) bpm *= 2;
  while (bpm > 165) bpm /= 2;
  bpm = Math.round(bpm * 10) / 10;

  // 위상: 박 위치들의 (저역 위주) onset 합이 최대인 지점
  const period = (60 * fps) / bpm;
  let bestPhase = 0;
  let bestSum = -Infinity;
  for (let phase = 0; phase < period; phase++) {
    let sum = 0;
    for (let p = phase; p < frames; p += period) {
      const f = Math.round(p);
      sum += (lowOnset[f] ?? 0) + 0.3 * (onset[f] ?? 0);
    }
    if (sum > bestSum) {
      bestSum = sum;
      bestPhase = phase;
    }
  }

  return { bpm, offset: Math.round((bestPhase / fps) * 1000) / 1000 };
}
