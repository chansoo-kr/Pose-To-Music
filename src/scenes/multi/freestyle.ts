import type { App } from "../../app";
import { listLibrary, saveChart, type Song } from "../../data/library";
import { assignCharts, newMatch, playerById, type Player } from "../../game/match";
import { DIFFICULTY_LABEL } from "../../pose/joints";
import { button, h, icon, label, panel } from "../../ui";
import { asyncScreen, difficultyPicker, emptyLibrary, screen, songInfo } from "../common";
import { ModeScene } from "../mode";
import { RecordScene } from "../record";
import { MultiBase, avatar } from "./common";
import { Wheel } from "./wheel";

/**
 * 프리스타일 멀티 (로컬, 한 기기).
 * 플레이어 등록 → 곡 후보 → 돌림판 → 채보 녹화(차례대로) → 섞어서 교환 → 플레이(차례대로) → 결과
 */
export class FreestyleMulti extends MultiBase {
  protected title = "프리스타일 · 멀티";
  protected steps = ["플레이어", "곡 후보", "돌림판", "녹화", "교환", "플레이", "결과"];

  constructor(app: App) {
    super(app, newMatch());
  }

  start() {
    this.players();
  }

  protected afterPlayers() {
    this.candidates();
  }

  protected chartFor(p: Player) {
    return playerById(this.match, p.assignedFrom)!.chart!;
  }

  protected playLines(p: Player): (string | Node)[] {
    const from = playerById(this.match, p.assignedFrom)!;
    return [`${from.name}의 채보를 따라 하세요. · ${DIFFICULTY_LABEL[this.match.difficulty]}`];
  }

  protected again() {
    this.match.song = undefined;
    this.candidates();
  }

  protected onExit() {
    this.app.go(new ModeScene(this.app, "freestyle"));
  }

  protected resultActions() {
    const recorded = this.list.filter((p) => p.chart);
    const save = button(
      "채보 저장",
      async () => {
        save.disabled = true;
        for (const p of recorded) await saveChart(p.chart!);
        save.lastElementChild!.textContent = `${recorded.length}개 저장됨`;
      },
      "",
      "save",
    );
    save.disabled = !recorded.length;
    save.title = "녹화한 채보를 기본 모드에서 쓸 수 있게 저장해요";
    return [save];
  }

  // 각자 곡 후보 선택
  private candidates() {
    const { app } = this;
    app.go(
      asyncScreen(async (root) => {
        const songs = (await listLibrary()).filter((e) => e.song.beats.length).map((e) => e.song);
        const next = button("돌림판으로", () => this.roulette(), "primary", "shuffle");
        const refresh = () => (next.disabled = !this.list.every((p) => p.candidate));
        for (const p of this.list) if (p.candidate && !songs.some((s) => s.id === p.candidate!.id)) p.candidate = undefined;

        const row = (p: Player) => {
          const select: HTMLSelectElement = h(
            "select",
            {
              onchange: () => {
                p.candidate = songs.find((s) => s.id === select.value);
                refresh();
              },
            },
            h("option", { value: "", disabled: true, selected: !p.candidate }, "곡을 고르세요"),
            ...songs.map((s) => h("option", { value: s.id, selected: p.candidate?.id === s.id }, s.title)),
          );
          return h("div", { class: "player-row" }, avatar(p), h("span", { class: "player-name" }, p.name), select);
        };

        root.append(
          panel(
            ...this.header(1, () => this.players()),
            songs.length
              ? h(
                  "div",
                  null,
                  h("p", { class: "muted" }, "각자 한 곡씩 고르면 돌림판으로 이번 판의 곡을 정해요."),
                  h("div", { class: "player-list" }, ...this.list.map(row)),
                )
              : emptyLibrary("박자가 있는 곡이 없어요."),
            h("div", { class: "row" }, next),
          ),
        );
        refresh();
      }),
    );
  }

  // 돌림판 → 곡 확정 + 난이도
  private roulette() {
    const { app, match } = this;
    app.go(
      screen((root) => {
        const entries = this.list.map((p) => ({ player: p, song: p.candidate! }));
        const wheel = new Wheel(entries.map((e) => ({ label: e.song.title, sub: e.player.name, color: e.player.color })));
        const after = h("div", { class: "roulette-after" });

        const spin = button(
          "돌리기",
          async () => {
            spin.disabled = true;
            const idx = await wheel.spin(() => app.audio.sfx("tick"));
            app.audio.sfx("select");
            match.song = entries[idx].song;
            spin.hidden = true;
            showSetup(match.song);
          },
          "primary",
          "shuffle",
        );

        const showSetup = (song: Song) =>
          after.replaceChildren(
            h(
              "div",
              { class: "picked" },
              h("small", null, "이번 판의 곡"),
              h("strong", null, song.title),
              h("span", { class: "muted" }, songInfo(song)),
            ),
            label("난이도"),
            difficultyPicker(match.difficulty, (d) => (match.difficulty = d)),
            h(
              "div",
              { class: "row" },
              button("다시 돌리기", () => this.roulette(), "", "refresh"),
              button("녹화 시작", () => this.recordTurn(0), "primary", "arrow"),
            ),
          );

        root.append(
          panel(...this.header(2, () => this.candidates()), wheel.el, h("div", { class: "row center" }, spin), after),
        );
      }),
    );
  }

  // 채보 녹화 (차례대로)
  private recordTurn(i: number) {
    const { app, match } = this;
    const p = this.list[i];
    if (!p) return this.swap();
    this.handoff(
      p,
      3,
      `${p.name}의 채보 녹화`,
      [
        `"${match.song!.title}"에 맞춰 다른 사람이 따라 할 포즈를 취하세요. (포즈 ${match.song!.beats.length}개)`,
        h("p", { class: "muted" }, "셔터 소리가 날 때의 포즈가 저장됩니다. 판정 관절이 잘 보이도록 크고 분명하게."),
      ],
      () =>
        app.go(
          new RecordScene(app, {
            song: match.song!,
            author: p.name,
            color: p.color,
            onDone: (chart) => {
              p.chart = chart;
              this.recordTurn(i + 1);
            },
            onBack: () => this.recordTurn(i),
          }),
        ),
    );
  }

  // 채보 섞어서 교환 (자기 것은 받지 않음)
  private swap() {
    const { app } = this;
    const map = assignCharts(this.list);
    for (const p of this.list) p.assignedFrom = map.get(p.id);
    app.go(
      screen((root) => {
        const rows = this.list.map((p) => {
          const from = playerById(this.match, p.assignedFrom)!;
          return h(
            "div",
            { class: "swap-row" },
            avatar(p),
            h("strong", null, p.name),
            h("span", { class: "swap-arrow" }, icon("back", 16)),
            avatar(from),
            h("span", null, `${from.name}의 채보`),
          );
        });
        root.append(
          panel(
            ...this.header(4),
            h("p", { class: "muted" }, "채보를 섞어서 나눠 받았어요. 자기 채보는 받지 않아요."),
            h("div", { class: "swap-list" }, ...rows),
            h("div", { class: "row" }, button("플레이 시작", () => this.playTurn(0), "primary", "play")),
          ),
        );
      }),
    );
  }
}
