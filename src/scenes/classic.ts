import type { App, Scene } from "../app";
import { listLibrary, type Song, type SongEntry } from "../data/library";
import type { Chart } from "../game/chart";
import type { PlayResult } from "../game/scoring";
import { DIFFICULTY_LABEL, type Difficulty } from "../pose/joints";
import { button, h, label, panel, panelHeader } from "../ui";
import { asyncScreen, chartInfo, difficultyPicker, emptyLibrary, rankOf, resultTable, screen, songList } from "./common";
import { ModeScene } from "./mode";
import { PlayScene } from "./play";

let lastDifficulty: Difficulty = "normal";

/** 채보 목록 (만든 사람 · 포즈 수 · 날짜) */
export function chartList(charts: Chart[], onPick: (c: Chart) => void, selectedId?: string) {
  return h(
    "div",
    { class: "list" },
    ...charts.map((c) =>
      h(
        "button",
        { class: `list-row${c.id === selectedId ? " selected" : ""}`, onclick: () => onPick(c) },
        h("span", { class: "list-title" }, `${c.author || "이름 없음"}의 채보`),
        h("span", { class: "list-meta" }, chartInfo(c)),
      ),
    ),
  );
}

/** 채보가 있는 곡만 */
export async function playableLibrary(): Promise<SongEntry[]> {
  return (await listLibrary()).filter((e) => e.song.beats.length && e.charts.length);
}

/** 기본 모드 싱글: 곡 → 채보 → 플레이 */
export class ClassicSingleScene implements Scene {
  private app: App;
  private songId?: string;

  constructor(app: App, songId?: string) {
    this.app = app;
    this.songId = songId;
  }

  enter(root: HTMLElement) {
    asyncScreen(async (r) => {
      const { app } = this;
      const entries = await playableLibrary();
      const back = () => app.go(new ModeScene(app, "classic"));
      if (!entries.length) {
        r.append(panel(panelHeader("기본 모드 · 싱글", { onBack: back }), emptyLibrary("채보가 있는 곡이 없어요.")));
        return;
      }

      const charts = h("div");
      const songs = h("div");
      const pick = (e: SongEntry) => {
        this.songId = e.song.id;
        songs.replaceChildren(songList(entries, pick, e.song.id));
        charts.replaceChildren(
          label(`"${e.song.title}"의 채보`),
          chartList(e.charts, (c) => playSingle(app, e.song, c, () => app.go(new ClassicSingleScene(app, e.song.id)))),
        );
      };
      songs.append(songList(entries, pick));
      const initial = entries.find((e) => e.song.id === this.songId);
      if (initial) pick(initial);

      const el = panel(
        panelHeader("기본 모드 · 싱글", { onBack: back }),
        label("난이도"),
        difficultyPicker(lastDifficulty, (d) => (lastDifficulty = d)),
        label("곡"),
        songs,
        charts,
      );
      el.classList.add("wide");
      r.append(el);
    }).enter(root);
  }
}

/** 싱글 플레이 → 결과 */
export function playSingle(
  app: App,
  song: Song,
  chart: Chart,
  onBack: () => void,
  extra?: (result: PlayResult) => HTMLElement | null,
) {
  app.go(
    new PlayScene(app, {
      song,
      chart,
      difficulty: lastDifficulty,
      playerName: "플레이어",
      onDone: (result) =>
        app.go(
          screen((root) => {
            const rank = rankOf(result.accuracy);
            root.append(
              panel(
                panelHeader("결과", { sub: `${song.title} · ${chart.author}의 채보 · ${DIFFICULTY_LABEL[lastDifficulty]}` }),
                h(
                  "div",
                  { class: "result-hero" },
                  h("div", { class: `rank rank-${rank.toLowerCase()}` }, rank),
                  h("div", { class: "big-score" }, result.score.toLocaleString()),
                ),
                resultTable(result),
                extra?.(result) ?? null,
                h(
                  "div",
                  { class: "row" },
                  button("나가기", onBack),
                  button("다시 하기", () => playSingle(app, song, chart, onBack, extra), "primary", "refresh"),
                ),
              ),
            );
          }),
        ),
      onBack,
    }),
  );
}

export const getDifficulty = () => lastDifficulty;
export const setDifficulty = (d: Difficulty) => (lastDifficulty = d);
