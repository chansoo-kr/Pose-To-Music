import type { Chart, Keyframe } from "../game/chart";
import { getSong, listCharts, newSong, saveChart, saveSong, type Song } from "./library";

/** 박자 정보 파일 (.ptm.json) */
export interface SongFile {
  format: "pose-to-music";
  version: 2;
  id: string;
  title: string;
  artist: string;
  /** 같은 폴더의 음악 파일 이름 */
  audio: string;
  durationSec: number;
  beats: number[];
  charts?: { id: string; author: string; createdAt: number; keyframes: Keyframe[] }[];
}

const JSON_EXT = ".ptm.json";
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** 파일 이름으로 쓸 수 없는 글자 제거 */
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").trim() || "song";

const extOf = (name: string) => name.match(/\.[^.]+$/)?.[0] ?? "";

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** 음악 파일과 .ptm.json 두 개를 내려받는다 */
export async function exportSong(song: Song, withCharts: boolean) {
  const base = safeName(song.title);
  const audioName = base + extOf(song.audioName);
  const charts = withCharts ? await listCharts(song.id) : [];
  const file: SongFile = {
    format: "pose-to-music",
    version: 2,
    id: song.id,
    title: song.title,
    artist: song.artist,
    audio: audioName,
    durationSec: round3(song.durationSec),
    beats: song.beats.map(round3),
    ...(charts.length
      ? { charts: charts.map(({ id, author, createdAt, keyframes }) => ({ id, author, createdAt, keyframes })) }
      : {}),
  };
  download(new Blob([JSON.stringify(file)], { type: "application/json" }), base + JSON_EXT);
  download(song.audio, audioName);
}

function parseSongFile(text: string): SongFile {
  const f = JSON.parse(text) as Partial<SongFile>;
  if (f.format !== "pose-to-music" || f.version !== 2) throw new Error("포트뮤 v2 박자 파일이 아니에요");
  if (!Array.isArray(f.beats) || !f.beats.every((b) => typeof b === "number" && b >= 0))
    throw new Error("박자 정보가 올바르지 않아요");
  if (typeof f.audio !== "string") throw new Error("음악 파일 이름이 없어요");
  return f as SongFile;
}

export const sortBeats = (beats: number[]) => [...new Set(beats.map(round3))].sort((a, b) => a - b);

export interface ImportResult {
  songs: Song[];
  errors: string[];
}

/**
 * 고른 파일들을 가져온다.
 * - .ptm.json + 음악 파일 → 박자/채보 포함한 곡
 * - 음악 파일만 → 박자 없는 새 곡
 * @param decide 같은 id의 곡이 이미 있을 때: true = 덮어쓰기, false = 사본으로 추가
 */
export async function importFiles(
  files: File[],
  ctx: BaseAudioContext,
  decide: (title: string) => boolean,
): Promise<ImportResult> {
  const jsons = files.filter((f) => f.name.toLowerCase().endsWith(".json"));
  const audios = files.filter((f) => !f.name.toLowerCase().endsWith(".json"));
  const used = new Set<File>();
  const result: ImportResult = { songs: [], errors: [] };

  const duration = async (f: File) => (await ctx.decodeAudioData(await f.arrayBuffer())).duration;

  for (const jf of jsons) {
    try {
      const meta = parseSongFile(await jf.text());
      const audio =
        audios.find((a) => a.name === meta.audio) ??
        (jsons.length === 1 && audios.length === 1 ? audios[0] : undefined);
      if (!audio) throw new Error(`음악 파일 "${meta.audio}"도 함께 골라 주세요`);
      used.add(audio);

      const exists = meta.id ? await getSong(meta.id) : undefined;
      const overwrite = exists ? decide(meta.title) : false;
      const song: Song = {
        ...newSong(audio, await duration(audio)),
        id: exists && !overwrite ? crypto.randomUUID() : meta.id || crypto.randomUUID(),
        title: String(meta.title || audio.name),
        artist: String(meta.artist ?? ""),
        beats: sortBeats(meta.beats),
      };
      await saveSong(song);
      for (const c of meta.charts ?? []) {
        const chart: Chart = {
          version: 2,
          id: overwrite || !exists ? c.id || crypto.randomUUID() : crypto.randomUUID(),
          songId: song.id,
          author: String(c.author ?? ""),
          createdAt: Number(c.createdAt) || Date.now(),
          keyframes: (c.keyframes ?? []).filter((k) => typeof k.t === "number" && Array.isArray(k.pose)),
        };
        await saveChart(chart);
      }
      result.songs.push(song);
    } catch (err) {
      result.errors.push(`${jf.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const af of audios) {
    if (used.has(af)) continue;
    try {
      const song = newSong(af, await duration(af));
      await saveSong(song);
      result.songs.push(song);
    } catch {
      result.errors.push(`${af.name}: 음악 파일을 읽을 수 없어요`);
    }
  }
  return result;
}
