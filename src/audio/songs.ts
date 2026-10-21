import type { Tempo } from "./beat";
import { renderTrack, type SynthTrackDef } from "./synth";

export interface Song extends Tempo {
  id: string;
  title: string;
  artist: string;
  source: "builtin" | "upload";
  /** 기본 수록곡은 합성 전에도 길이를 안다 */
  durationSec?: number;
  load(): Promise<AudioBuffer>;
}

interface BuiltinDef {
  id: string;
  title: string;
  track: SynthTrackDef;
}

const BUILTIN_DEFS: BuiltinDef[] = [
  {
    id: "neon-step",
    title: "Neon Step",
    track: {
      bpm: 100,
      bars: 16,
      chords: [
        [57, 60, 64],
        [53, 57, 60],
        [48, 52, 55],
        [55, 59, 62],
      ],
      kick: "x.....x...x.....",
      arp: [0, 1, 2, 3, 2, 1],
      leadWave: "triangle",
    },
  },
  {
    id: "pulse-runner",
    title: "Pulse Runner",
    track: {
      bpm: 120,
      bars: 20,
      chords: [
        [50, 53, 57],
        [46, 50, 53],
        [53, 57, 60],
        [48, 52, 55],
      ],
      kick: "x...x...x...x...",
      arp: [0, 2, 1, 3, 2, 4],
      leadWave: "square",
    },
  },
  {
    id: "hyper-jump",
    title: "Hyper Jump",
    track: {
      bpm: 140,
      bars: 22,
      chords: [
        [52, 55, 59],
        [48, 52, 55],
        [55, 59, 62],
        [50, 54, 57],
      ],
      kick: "x...x...x...x.x.",
      arp: [0, 1, 2, 3, 4, 3, 2, 1],
      leadWave: "sawtooth",
    },
  },
];

const cache = new Map<string, Promise<AudioBuffer>>();

export const BUILTIN_SONGS: Song[] = BUILTIN_DEFS.map((d) => ({
  id: d.id,
  title: d.title,
  artist: "포트뮤 기본 수록곡",
  source: "builtin",
  bpm: d.track.bpm,
  offsetMs: 0,
  durationSec: (d.track.bars * 4 * 60) / d.track.bpm,
  load() {
    let p = cache.get(d.id);
    if (!p) {
      p = renderTrack(d.track);
      cache.set(d.id, p);
    }
    return p;
  },
}));

const uploads = new Map<string, Song>();

export function registerUpload(name: string, buffer: AudioBuffer, tempo: Tempo): Song {
  const song: Song = {
    id: `upload-${crypto.randomUUID()}`,
    title: name.replace(/\.[^.]+$/, ""),
    artist: "업로드한 음악",
    source: "upload",
    ...tempo,
    load: () => Promise.resolve(buffer),
  };
  uploads.set(song.id, song);
  return song;
}

export function findSong(id: string): Song | undefined {
  return BUILTIN_SONGS.find((s) => s.id === id) ?? uploads.get(id);
}
