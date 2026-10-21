import type { App, Scene } from "../app";
import { BUILTIN_SONGS, findSong, type Song } from "../audio/songs";
import { deleteChart, loadSavedCharts, makeBuiltinChart, type Chart } from "../game/chart";
import { GRADES, type PlayResult } from "../game/scoring";
import { DIFFICULTIES, DIFFICULTY_JOINTS, DIFFICULTY_LABEL, type Difficulty } from "../pose/joints";
import { button, h, icon, iconButton, label, panel, panelHeader } from "../ui";
import { PlayScene } from "./play";
import { TitleScene } from "./title";

let lastDifficulty: Difficulty = "normal";

/** 난이도 세그먼트 컨트롤 */
export function difficultyPicker(value: Difficulty, onChange: (d: Difficulty) => void) {
  const wrap = h("div", { class: "segmented" });
  const render = (cur: Difficulty) => {
    wrap.replaceChildren(
      ...DIFFICULTIES.map((d) =>
        h(
          "button",
          {
            class: `seg${d === cur ? " active" : ""}`,
            onclick: () => {
              onChange(d);
              render(d);
            },
          },
          h("strong", null, DIFFICULTY_LABEL[d]),
          h("small", null, `관절 ${DIFFICULTY_JOINTS[d].length}`),
        ),
      ),
    );
  };
  render(value);
  return wrap;
}

/** 곡 id로 만드는 그라디언트 커버 */
export function songCover(id: string, size: "md" | "sm" = "md") {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return h(
    "span",
    {
      class: `cover cover-${size}`,
      style: `--h1:${hue};--h2:${(hue + 70) % 360}`,
    },
    icon("music", size === "md" ? 22 : 16),
  );
}

const formatTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

/** 싱글 플레이: 곡(안무) 선택 */
export class SingleSelectScene implements Scene {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  enter(root: HTMLElement) {
    const { app } = this;

    const play = (song: Song, chart: Chart | null) => {
      const c = chart ?? makeBuiltinChart(song, song.durationSec!);
      app.go(
        new PlayScene(app, {
          song,
          chart: c,
          difficulty: lastDifficulty,
          playerName: "플레이어",
          onDone: (result) => app.go(new SingleResultScene(app, song, c, result)),
          onBack: () => app.go(new SingleSelectScene(app)),
        }),
      );
    };

    const builtin = BUILTIN_SONGS.map((song) =>
      h(
        "button",
        { class: "song-card", onclick: () => play(song, null) },
        songCover(song.id),
        h(
          "span",
          { class: "song-meta" },
          h("strong", null, song.title),
          h("span", null, `${song.bpm} BPM · ${formatTime(song.durationSec ?? 0)}`),
        ),
        h("span", { class: "song-play" }, icon("play", 16)),
      ),
    );

    const saved = loadSavedCharts().map((chart) => {
      const song = findSong(chart.songId);
      return h(
        "div",
        { class: "list-row" },
        h(
          "button",
          { class: "list-main", disabled: !song, onclick: () => song && play(song, chart) },
          songCover(chart.songId, "sm"),
          h(
            "span",
            { class: "song-meta" },
            h("strong", null, `${chart.author}의 안무`),
            h("span", null, `${chart.songTitle} · 포즈 ${chart.keyframes.length}개${song ? "" : " · 음원 없음"}`),
          ),
        ),
        iconButton("trash", "삭제", () => {
          deleteChart(chart.id);
          app.go(new SingleSelectScene(app));
        }),
      );
    });

    const el = panel(
      panelHeader("곡 선택", { kicker: "Solo", onBack: () => app.go(new TitleScene(app)) }),
      label("난이도"),
      difficultyPicker(lastDifficulty, (d) => (lastDifficulty = d)),
      label("기본 수록곡"),
      h("div", { class: "song-grid" }, ...builtin),
      saved.length ? label("저장된 안무") : null,
      saved.length ? h("div", { class: "list" }, ...saved) : null,
    );
    el.classList.add("wide");
    root.append(el);
  }
}

export function resultTable(result: PlayResult) {
  return h(
    "div",
    { class: "stat-grid" },
    ...GRADES.map((g) =>
      h(
        "div",
        { class: `stat judge-${g.toLowerCase()}` },
        h("small", null, g),
        h("strong", null, String(result.counts[g])),
      ),
    ),
    h("div", { class: "stat" }, h("small", null, "MAX COMBO"), h("strong", null, String(result.maxCombo))),
    h(
      "div",
      { class: "stat" },
      h("small", null, "ACCURACY"),
      h("strong", null, `${Math.round(result.accuracy * 100)}%`),
    ),
  );
}

export function rankOf(accuracy: number) {
  if (accuracy >= 0.9) return "S";
  if (accuracy >= 0.8) return "A";
  if (accuracy >= 0.65) return "B";
  if (accuracy >= 0.5) return "C";
  return "D";
}

class SingleResultScene implements Scene {
  private app: App;
  private song: Song;
  private chart: Chart;
  private result: PlayResult;

  constructor(app: App, song: Song, chart: Chart, result: PlayResult) {
    this.app = app;
    this.song = song;
    this.chart = chart;
    this.result = result;
  }

  enter(root: HTMLElement) {
    const { app, song, chart, result } = this;
    const rank = rankOf(result.accuracy);
    root.append(
      panel(
        panelHeader("결과", { kicker: `${song.title} · ${DIFFICULTY_LABEL[lastDifficulty]}` }),
        h(
          "div",
          { class: "result-hero" },
          h("div", { class: `rank rank-${rank.toLowerCase()}` }, rank),
          h(
            "div",
            null,
            h("div", { class: "big-score" }, result.score.toLocaleString()),
            h("div", { class: "muted" }, `${chart.author}의 안무`),
          ),
        ),
        resultTable(result),
        h(
          "div",
          { class: "row" },
          button("곡 선택", () => app.go(new SingleSelectScene(app)), "ghost"),
          button(
            "다시 하기",
            () =>
              app.go(
                new PlayScene(app, {
                  song,
                  chart,
                  difficulty: lastDifficulty,
                  playerName: "플레이어",
                  onDone: (r) => app.go(new SingleResultScene(app, song, chart, r)),
                  onBack: () => app.go(new SingleSelectScene(app)),
                }),
              ),
            "primary",
            "refresh",
          ),
        ),
      ),
    );
  }
}
