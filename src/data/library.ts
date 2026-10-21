import type { Chart } from "../game/chart";
import { del, get, getAll, getAllBy, put } from "./db";

/** 곡: 음악 파일 + 박자 시각 목록 */
export interface Song {
  id: string;
  title: string;
  artist: string;
  /** 원본 오디오 파일 */
  audio: Blob;
  audioName: string;
  durationSec: number;
  /** 박자(포즈 판정) 시각(초), 오름차순 */
  beats: number[];
  createdAt: number;
  updatedAt: number;
}

/** 목록 화면용 요약 (채보 수 포함) */
export interface SongEntry {
  song: Song;
  charts: Chart[];
}

export const listSongs = async () =>
  (await getAll<Song>("songs")).sort((a, b) => b.updatedAt - a.updatedAt);

export const getSong = (id: string) => get<Song>("songs", id);

export async function saveSong(song: Song) {
  await put("songs", song);
  audioCache.delete(song.id);
}

/** 곡과 그 곡의 채보를 모두 지운다 */
export async function deleteSong(id: string) {
  for (const c of await listCharts(id)) await del("charts", c.id);
  await del("songs", id);
  audioCache.delete(id);
}

export const listCharts = async (songId: string) =>
  (await getAllBy<Chart>("charts", "songId", songId)).sort((a, b) => b.createdAt - a.createdAt);

export const saveChart = (chart: Chart) => put("charts", chart);
export const deleteChart = (id: string) => del("charts", id);

/** 곡 + 채보 목록 */
export async function listLibrary(): Promise<SongEntry[]> {
  const songs = await listSongs();
  const all = await getAll<Chart>("charts");
  return songs.map((song) => ({
    song,
    charts: all.filter((c) => c.songId === song.id).sort((a, b) => b.createdAt - a.createdAt),
  }));
}

export function newSong(file: File, durationSec: number): Song {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: file.name.replace(/\.[^.]+$/, ""),
    artist: "",
    audio: file,
    audioName: file.name,
    durationSec,
    beats: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ---- 디코딩 캐시 ----

const audioCache = new Map<string, { updatedAt: number; buffer: Promise<AudioBuffer> }>();

export function loadAudio(song: Song, ctx: BaseAudioContext): Promise<AudioBuffer> {
  const hit = audioCache.get(song.id);
  if (hit && hit.updatedAt === song.updatedAt) return hit.buffer;
  const buffer = song.audio.arrayBuffer().then((data) => ctx.decodeAudioData(data));
  audioCache.set(song.id, { updatedAt: song.updatedAt, buffer });
  buffer.catch(() => audioCache.delete(song.id));
  return buffer;
}

// ---- 초기화 ----

/** v1 안무(localStorage)는 음원이 없어 쓸 수 없으므로 지우고, 저장소 유지를 요청한다 */
export function initLibrary() {
  try {
    localStorage.removeItem("ptm.charts");
  } catch {
    /* 무시 */
  }
  void navigator.storage?.persist?.().catch(() => {});
}
