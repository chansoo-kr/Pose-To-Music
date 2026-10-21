/**
 * 저작권 걱정 없는 기본 수록곡을 즉석에서 합성한다.
 *
 * OfflineAudioContext로 음마다 노드를 만들면 수천 개 노드에서 수십 초씩 걸려서,
 * 샘플 버퍼에 직접 더하는 방식으로 합성한다 (40초 곡 기준 수십 ms).
 */

export interface SynthTrackDef {
  bpm: number;
  bars: number;
  /** 마디마다 하나씩 반복되는 코드 (MIDI 노트, 최저음 = 베이스 루트) */
  chords: number[][];
  /** 16분음표 단위 킥 패턴 (1마디 = 16칸) */
  kick: string;
  /** 리드 아르페지오 순서 (코드 구성음 인덱스) */
  arp: number[];
  leadWave: "triangle" | "square" | "sawtooth";
}

const SR = 44100;
const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

type Wave = SynthTrackDef["leadWave"];

function osc(wave: Wave, phase: number) {
  const f = phase - Math.floor(phase);
  switch (wave) {
    case "sawtooth":
      return 2 * f - 1;
    case "square":
      return f < 0.5 ? 1 : -1;
    case "triangle":
      return 4 * Math.abs(f - 0.5) - 1;
  }
}

export async function renderTrack(def: SynthTrackDef): Promise<AudioBuffer> {
  const beat = 60 / def.bpm;
  const step = beat / 4;
  const barLen = beat * 4;
  const duration = def.bars * barLen + 2;
  const length = Math.ceil(duration * SR);
  const L = new Float32Array(length);
  const R = new Float32Array(length);

  /** [t, t+dur) 구간에 sample(i, 경과초)를 pan(-1~1)으로 더한다 */
  const mix = (t: number, dur: number, pan: number, sample: (i: number, s: number) => number) => {
    const start = Math.floor(t * SR);
    const end = Math.min(length, start + Math.ceil(dur * SR));
    const gl = Math.min(1, 1 - pan);
    const gr = Math.min(1, 1 + pan);
    for (let i = start, n = 0; i < end; i++, n++) {
      const v = sample(n, n / SR);
      L[i] += v * gl;
      R[i] += v * gr;
    }
  };

  let seed = 12345;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x3fffffff - 1;
  };

  const kick = (t: number) => {
    let phase = 0;
    mix(t, 0.35, 0, (_, s) => {
      phase += (45 + 105 * Math.exp(-s / 0.03)) / SR;
      return Math.sin(2 * Math.PI * phase) * Math.exp(-s / 0.09) * 0.9;
    });
  };

  /** 1차 하이패스 노이즈 */
  const noiseHit = (t: number, decay: number, vol: number, hp: number, pan: number) => {
    const a = 1 / (1 + (2 * Math.PI * hp) / SR);
    let prevX = 0;
    let y = 0;
    mix(t, decay * 6, pan, (_, s) => {
      const x = noise();
      y = a * (y + x - prevX);
      prevX = x;
      return y * vol * Math.exp(-s / decay);
    });
  };

  const snare = (t: number) => {
    noiseHit(t, 0.05, 0.35, 1500, 0);
    mix(t, 0.12, 0, (_, s) => osc("triangle", 190 * s) * 0.3 * Math.exp(-s / 0.03));
  };

  /** 1차 로우패스를 거친 음 */
  const tone = (
    t: number,
    dur: number,
    midi: number,
    wave: Wave,
    vol: number,
    cutoff: number,
    pan = 0,
    attack = 0.005,
  ) => {
    const hz = midiToHz(midi);
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
    const release = 0.05;
    let y = 0;
    mix(t, dur, pan, (_, s) => {
      y += a * (osc(wave, hz * s) - y);
      const env = Math.min(1, s / attack, (dur - s) / release);
      return y * vol * Math.max(0, env);
    });
  };

  for (let bar = 0; bar < def.bars; bar++) {
    const t0 = bar * barLen;
    const chord = def.chords[bar % def.chords.length];
    const intro = bar < 2;
    const outro = bar === def.bars - 1;
    const full = bar >= 4 && !outro;

    for (let s = 0; s < 16; s++) {
      const t = t0 + s * step;
      if (def.kick[s] === "x" && !(intro && s % 4 !== 0)) kick(t);
      if (!intro && (s === 4 || s === 12)) snare(t);
      if (s % 2 === 0) noiseHit(t, 0.012, s % 4 === 2 ? 0.16 : 0.09, 7000, 0.3);
      else if (full) noiseHit(t, 0.008, 0.06, 9000, -0.3);
    }

    if (!intro) {
      // 베이스: 8분음표
      for (let e = 0; e < 8; e++) {
        const midi = chord[0] - 12 + (e % 4 === 3 ? 12 : 0);
        tone(t0 + e * beat * 0.5, beat * 0.45, midi, "sawtooth", 0.3, 500);
      }
      // 패드
      for (const n of chord) tone(t0, barLen, n + 12, "triangle", 0.06, 1800, 0, 0.08);
    }

    if (full) {
      // 리드 아르페지오: 16분음표
      for (let s = 0; s < 16; s++) {
        const idx = def.arp[s % def.arp.length];
        const midi = chord[idx % chord.length] + 24 + (idx >= chord.length ? 12 : 0);
        tone(t0 + s * step, step * 0.8, midi, def.leadWave, 0.06, 3500, s % 2 ? 0.25 : -0.25);
      }
    }
  }

  // 마지막 마무리 킥 + 심벌
  const end = def.bars * barLen;
  kick(end);
  noiseHit(end, 0.4, 0.25, 4000, 0);

  // 부드러운 리미터 (tanh) 후 피크 정규화
  let peak = 0;
  for (let i = 0; i < length; i++) {
    L[i] = Math.tanh(L[i] * 1.2);
    R[i] = Math.tanh(R[i] * 1.2);
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const gain = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < length; i++) {
    L[i] *= gain;
    R[i] *= gain;
  }

  const buffer = new AudioBuffer({ length, sampleRate: SR, numberOfChannels: 2 });
  buffer.copyToChannel(L, 0);
  buffer.copyToChannel(R, 1);
  return buffer;
}
