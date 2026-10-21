import type { App } from "../../app";
import { deleteChart, listCharts, saveChart, type Song } from "../../data/library";
import { libraryChart, libraryPose, type Chart } from "../../game/chart";
import { POSE_LIBRARY } from "../../game/poses";
import { button, formatTimeMs, h, iconButton } from "../../ui";
import { chartInfo, poseThumb, withTracker } from "../common";
import { RecordScene } from "../record";
import { EditorScene } from "./edit";
import { PreviewScene } from "./preview";

let lastAuthor = "나";

/** 에디터 [채보] 탭: 채보 목록, 새로 만들기(녹화 / 포즈 라이브러리), 박자별 포즈 바꾸기 */
export class ChartsTab {
  readonly el = h("div", { class: "charts-tab" });
  private app: App;
  private song: Song;
  private unsaved: boolean;
  private onCount: (n: number) => void;

  constructor(app: App, song: Song, unsaved: boolean, onCount: (n: number) => void) {
    this.app = app;
    this.song = song;
    this.unsaved = unsaved;
    this.onCount = onCount;
    void this.renderList();
  }

  private backToEditor = () => this.app.go(new EditorScene(this.app, this.song.id, "charts"));

  private async renderList() {
    const { app, song } = this;
    const charts = await listCharts(song.id);
    this.onCount(charts.length);

    const author = h("input", {
      value: lastAuthor,
      maxLength: 12,
      placeholder: "만든 사람",
      oninput: (e: Event) => (lastAuthor = (e.target as HTMLInputElement).value.trim() || "나"),
    });
    const canCreate = song.beats.length > 0 && !this.unsaved;
    const record = button(
      "카메라로 녹화",
      () =>
        void withTracker(app, () =>
          app.go(
            new RecordScene(app, {
              song,
              author: lastAuthor,
              onDone: async (chart) => {
                await saveChart(chart);
                this.backToEditor();
              },
              onBack: this.backToEditor,
            }),
          ),
        ),
      "",
      "camera",
    );
    const fill = button(
      "포즈 라이브러리로 채우기",
      async () => {
        const chart = libraryChart(song, lastAuthor);
        await saveChart(chart);
        this.onCount(charts.length + 1);
        this.renderDetail(chart);
      },
      "",
      "shuffle",
    );
    record.disabled = fill.disabled = !canCreate;

    this.el.replaceChildren(
      h("div", { class: "toolbar" }, h("label", { class: "field inline" }, h("span", null, "만든 사람"), author), record, fill),
      !song.beats.length
        ? h("p", { class: "warn" }, "박자가 없어요. [박자] 탭에서 먼저 박자를 찍어 주세요.")
        : this.unsaved
          ? h("p", { class: "warn" }, "저장하지 않은 박자 변경이 있어요. 저장한 뒤 채보를 만들 수 있어요.")
          : h("p", { class: "hint" }, `새 채보는 지금 박자 ${song.beats.length}개에 맞춰 만들어져요.`),
      charts.length
        ? h(
            "div",
            { class: "list" },
            ...charts.map((c) =>
              h(
                "div",
                { class: "list-row static" },
                h("span", { class: "list-title" }, `${c.author || "이름 없음"}의 채보`),
                h("span", { class: "list-meta" }, chartInfo(c)),
                h(
                  "span",
                  { class: "list-actions" },
                  iconButton("eye", "미리보기", () => app.go(new PreviewScene(app, song, c, this.backToEditor))),
                  iconButton("edit", "포즈 편집", () => this.renderDetail(c)),
                  iconButton("trash", "삭제", async () => {
                    if (!confirm(`${c.author}의 채보를 지울까요?`)) return;
                    await deleteChart(c.id);
                    void this.renderList();
                  }),
                ),
              ),
            ),
          )
        : h("div", { class: "empty" }, "아직 채보가 없어요."),
    );
  }

  /** 채보 하나: 만든 사람 이름, 박자별 포즈 바꾸기 (바꾸면 바로 저장) */
  private renderDetail(chart: Chart) {
    const save = () => void saveChart(chart);
    const author = h("input", {
      value: chart.author,
      maxLength: 12,
      onchange: (e: Event) => {
        chart.author = (e.target as HTMLInputElement).value.trim() || "이름 없음";
        save();
      },
    });

    const rows = chart.keyframes.map((k, i) => {
      const thumb = h("span", { class: "thumb" }, poseThumb(k.pose));
      const select: HTMLSelectElement = h(
        "select",
        {
          onchange: () => {
            const idx = Number(select.value);
            k.pose = libraryPose(idx);
            k.lib = idx;
            thumb.replaceChildren(poseThumb(k.pose));
            save();
          },
        },
        k.lib === undefined ? h("option", { value: "", selected: true, disabled: true }, "녹화한 포즈") : null,
        ...POSE_LIBRARY.map((p, idx) => h("option", { value: idx, selected: k.lib === idx }, p.name)),
      );
      return h(
        "div",
        { class: "pose-row" },
        h("span", { class: "pose-idx" }, String(i + 1)),
        h("span", { class: "pose-time" }, formatTimeMs(k.t)),
        thumb,
        select,
      );
    });

    this.el.replaceChildren(
      h(
        "div",
        { class: "toolbar" },
        button("채보 목록", () => void this.renderList(), "", "back"),
        h("label", { class: "field inline" }, h("span", null, "만든 사람"), author),
        button("미리보기", () => this.app.go(new PreviewScene(this.app, this.song, chart, this.backToEditor)), "", "eye"),
      ),
      h("p", { class: "hint" }, "포즈를 바꾸면 바로 저장돼요. 그림은 화면에 보이는 방향(거울) 기준이에요."),
      h("div", { class: "pose-list" }, ...rows),
    );
  }
}
