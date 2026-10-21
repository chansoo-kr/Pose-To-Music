import type { App } from "../app";
import { listLibrary, saveChart, type Song } from "../data/library";
import type { Chart } from "../game/chart";
import { button, h, label, panel, panelHeader } from "../ui";
import { getDifficulty, playSingle, setDifficulty } from "./classic";
import { asyncScreen, difficultyPicker, emptyLibrary, songList } from "./common";
import { ModeScene } from "./mode";
import { RecordScene } from "./record";

/** 프리스타일 싱글: 곡 선택 → 내 포즈 녹화 → 바로 따라 하기 → (저장) */
export class FreestyleSingle {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  start() {
    const { app } = this;
    app.go(
      asyncScreen(async (root) => {
        const entries = (await listLibrary()).filter((e) => e.song.beats.length);
        const back = () => app.go(new ModeScene(app, "freestyle"));
        const el = panel(
          panelHeader("프리스타일 · 싱글", { onBack: back }),
          entries.length
            ? h(
                "div",
                null,
                h("p", { class: "muted" }, "곡의 박자마다 셔터가 울리면 포즈를 취하세요. 녹화가 끝나면 그 채보를 바로 따라 합니다."),
                label("난이도"),
                difficultyPicker(getDifficulty(), setDifficulty),
                label("곡"),
                songList(entries, (e) => this.record(e.song)),
              )
            : emptyLibrary("박자가 있는 곡이 없어요."),
        );
        el.classList.add("wide");
        root.append(el);
      }),
    );
  }

  private record(song: Song) {
    const { app } = this;
    app.go(
      new RecordScene(app, {
        song,
        author: "나",
        onDone: (chart) => this.play(song, chart),
        onBack: () => this.start(),
      }),
    );
  }

  private play(song: Song, chart: Chart) {
    let saved = false;
    playSingle(this.app, song, chart, () => this.start(), () => {
      const name = h("input", { value: "나", maxLength: 12, placeholder: "만든 사람" });
      const save = button(
        saved ? "저장됨" : "채보 저장",
        async () => {
          chart.author = name.value.trim() || "나";
          await saveChart(chart);
          saved = true;
          save.disabled = true;
          save.lastElementChild!.textContent = "저장됨 · 기본 모드에서 플레이할 수 있어요";
        },
        "",
        "save",
      );
      save.disabled = saved;
      name.disabled = saved;
      save.addEventListener("click", () => (name.disabled = true));
      return h("div", { class: "row left" }, name, save);
    });
  }
}
