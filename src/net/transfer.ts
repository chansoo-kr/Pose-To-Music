import { sha256Hex } from "../data/hash";
import { ensureHash, findSongByHash, type Song } from "../data/library";
import type { Chart } from "../game/chart";
import type { ChartMeta, SongMeta } from "./protocol";

/** 네트워크로 받은 곡 (오디오 해시 → 곡). 저장하기 전까지 메모리에만 둔다 */
const received = new Map<string, Song>();

export async function songMetaOf(song: Song): Promise<SongMeta> {
  return {
    id: song.id,
    hash: await ensureHash(song),
    title: song.title,
    artist: song.artist,
    audioName: song.audioName,
    type: song.audio.type,
    size: song.audio.size,
    durationSec: song.durationSec,
    beats: song.beats,
  };
}

export const chartMetaOf = (chart: Chart): ChartMeta => ({
  id: chart.id,
  author: chart.author,
  poses: chart.keyframes.length,
});

/** 라이브러리 또는 받은 곡에서 같은 음악을 찾는다 */
export async function findLocalSong(hash: string): Promise<Song | undefined> {
  return received.get(hash) ?? (await findSongByHash(hash));
}

export const receivedHashes = () => [...received.keys()];

/** 받은 음악이 해시와 맞으면 곡으로 만들어 캐시에 넣는다 */
export async function acceptSong(data: ArrayBuffer, meta: SongMeta): Promise<Song | null> {
  if ((await sha256Hex(data)) !== meta.hash) return null;
  const now = Date.now();
  const song: Song = {
    id: meta.id,
    title: meta.title,
    artist: meta.artist,
    audio: new Blob([data], { type: meta.type }),
    audioName: meta.audioName || `${meta.title}.audio`,
    durationSec: meta.durationSec,
    beats: meta.beats,
    createdAt: now,
    updatedAt: now,
    audioHash: meta.hash,
  };
  received.set(meta.hash, song);
  return song;
}

/** 내 음악 + 방장의 제목·박자 */
export const withMeta = (base: Song, meta: SongMeta): Song => ({
  ...base,
  title: meta.title,
  artist: meta.artist,
  beats: meta.beats,
});
