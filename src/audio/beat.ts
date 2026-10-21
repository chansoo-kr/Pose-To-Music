export interface Tempo {
  bpm: number;
  /** 첫 박이 나오는 시점(ms) */
  offsetMs: number;
}

export const beatSec = (t: Tempo) => 60 / t.bpm;

export const beatToTime = (t: Tempo, beat: number) => t.offsetMs / 1000 + beat * beatSec(t);

/**
 * 포즈를 잡을 박자 목록.
 * @param interval 몇 박마다 포즈 하나
 * @param leadInBeats 처음 몇 박은 준비 시간으로 비움
 * @param endSec 이 시점 전까지만
 */
export function poseBeats(t: Tempo, interval: number, leadInBeats: number, endSec: number): number[] {
  const beats: number[] = [];
  const tail = 1.0; // 곡 끝 직전은 비움
  for (let b = leadInBeats; beatToTime(t, b) < endSec - tail; b += interval) beats.push(b);
  return beats;
}

/**
 * 간단한 BPM / 첫 박 위치 추정 (onset envelope 자기상관).
 * 정확하지 않을 수 있으니 UI에서 수동 보정을 함께 제공한다.
 */
export function detectTempo(buffer: AudioBuffer): Tempo {
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

  return { bpm, offsetMs: Math.round((bestPhase / fps) * 1000) };
}

/** 탭 템포: 최근 탭 간격 평균으로 BPM 계산 */
export class TapTempo {
  private taps: number[] = [];

  tap(): number | null {
    const now = performance.now();
    if (this.taps.length && now - this.taps[this.taps.length - 1] > 2000) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > 8) this.taps.shift();
    if (this.taps.length < 3) return null;
    const span = this.taps[this.taps.length - 1] - this.taps[0];
    return Math.round((60000 * (this.taps.length - 1)) / span);
  }
}
