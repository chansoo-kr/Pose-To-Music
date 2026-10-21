import type { App } from "../../app";
import type { SongEntry } from "../../data/library";
import { newMatch, type Player } from "../../game/match";
import { DIFFICULTY_LABEL } from "../../pose/joints";
import { button, h, label, panel } from "../../ui";
import { chartList, playableLibrary } from "../classic";
import { asyncScreen, difficultyPicker, emptyLibrary, songList } from "../common";
import { ModeScene } from "../mode";
import { MultiBase, avatar } from "./common";

/**
 * 기본 모드 멀티: 플레이어 등록 → 방장이 곡·채보·난이도 선택 → 차례대로 플레이 → 순위
 */
export class ClassicMulti extends MultiBase {
  protected title = "기본 모드 · 멀티";
  protected steps = ["플레이어", "채보 선택", "플레이", "순위"];

  constructor(app: App) {
    super(app, newMatch());
  }

  start() {
    this.players();
  }

  protected afterPlayers() {
    this.select();
  }

  protected chartFor() {
    return this.match.chart!;
  }

  protected playLines(): (string | Node)[] {
    const { match } = this;
    return [`${match.chart!.author}의 채보를 따라 하세요. · ${DIFFICULTY_LABEL[match.difficulty]}`];
  }

  protected again() {
    this.select();
  }

  protected onExit() {
    this.app.go(new ModeScene(this.app, "classic"));
  }

  private get host(): Player {
    return this.list[0];
  }

  // 방장이 곡 · 채보 · 난이도 선택
  private select() {
    const { app, match } = this;
    app.go(
      asyncScreen(async (root) => {
        const entries = await playableLibrary();
        const start = button("플레이 시작", () => this.playTurn(0), "primary", "play");
        const songs = h("div");
        const charts = h("div");

        const refresh = () => (start.disabled = !match.song || !match.chart);
        const pickSong = (e: SongEntry) => {
          if (match.song?.id !== e.song.id) match.chart = undefined;
          match.song = e.song;
          songs.replaceChildren(songList(entries, pickSong, e.song.id));
          const renderCharts = () =>
            charts.replaceChildren(
              label("채보"),
              chartList(
                e.charts,
                (c) => {
                  match.chart = c;
                  renderCharts();
                  refresh();
                },
                match.chart?.id,
              ),
            );
          renderCharts();
          refresh();
        };
        songs.append(songList(entries, pickSong));
        const current = entries.find((e) => e.song.id === match.song?.id);
        if (current) pickSong(current);
        else match.song = match.chart = undefined;
        refresh();

        const el = panel(
          ...this.header(1, () => this.players()),
          h("div", { class: "host" }, avatar(this.host), h("span", null, `방장 ${this.host.name}님이 골라 주세요.`)),
          entries.length
            ? h(
                "div",
                null,
                label("난이도"),
                difficultyPicker(match.difficulty, (d) => (match.difficulty = d)),
                label("곡"),
                songs,
                charts,
              )
            : emptyLibrary("채보가 있는 곡이 없어요."),
          h("div", { class: "row" }, start),
        );
        el.classList.add("wide");
        root.append(el);
      }),
    );
  }
}
