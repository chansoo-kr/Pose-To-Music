import type { App, Scene } from "../../app";
import { exportSong, importFiles } from "../../data/io";
import { deleteSong, listLibrary } from "../../data/library";
import { button, formatDate, formatTime, h, iconButton, panelHeader, setChildren } from "../../ui";
import { TitleScene } from "../title";
import { EditorScene } from "./edit";

let exportCharts = true;

/** 채보 에디터: 곡 목록, 음악 추가, 가져오기/내보내기 */
export class EditorListScene implements Scene {
  private app: App;
  private root!: HTMLElement;
  private message = h("div", { class: "editor-status" });
  private table = h("div");

  constructor(app: App) {
    this.app = app;
  }

  enter(root: HTMLElement) {
    const { app } = this;
    this.root = root;

    const picker = (accept: string) =>
      h("input", {
        type: "file",
        accept,
        multiple: true,
        hidden: true,
        onchange: (e: Event) => {
          const input = e.target as HTMLInputElement;
          void this.import([...(input.files ?? [])]);
          input.value = "";
        },
      });
    const addInput = picker("audio/*");
    const importInput = picker("audio/*,.json,application/json");
    const withCharts = h("input", {
      type: "checkbox",
      checked: exportCharts,
      onchange: (e: Event) => (exportCharts = (e.target as HTMLInputElement).checked),
    });

    const page = h(
      "div",
      { class: "page" },
      panelHeader("채보 에디터", { onBack: () => app.go(new TitleScene(app)) }),
      h(
        "div",
        { class: "toolbar" },
        button("음악 추가", () => addInput.click(), "primary", "plus"),
        button("가져오기", () => importInput.click(), "", "upload"),
        h("label", { class: "check" }, withCharts, "내보낼 때 채보 포함"),
        addInput,
        importInput,
      ),
      h(
        "p",
        { class: "hint" },
        "곡 = 음악 파일 + 박자 정보 파일(.ptm.json). 가져오기에서 두 파일을 함께 고르거나 이 화면에 끌어다 놓으세요. 음악만 넣으면 박자 없는 새 곡이 돼요.",
      ),
      this.message,
      this.table,
    );
    root.append(page);

    // 끌어다 놓기
    page.addEventListener("dragover", (e) => {
      e.preventDefault();
      page.classList.add("dragging");
    });
    page.addEventListener("dragleave", () => page.classList.remove("dragging"));
    page.addEventListener("drop", (e) => {
      e.preventDefault();
      page.classList.remove("dragging");
      void this.import([...(e.dataTransfer?.files ?? [])]);
    });

    void this.render();
  }

  private async render() {
    const { app } = this;
    const entries = await listLibrary();
    if (!entries.length) {
      this.table.replaceChildren(h("div", { class: "empty" }, "곡이 없어요. 음악 파일을 추가해 주세요."));
      return;
    }
    this.table.replaceChildren(
      h(
        "table",
        { class: "table" },
        h(
          "thead",
          null,
          h("tr", null, h("th", null, "제목"), h("th", null, "길이"), h("th", null, "박자"), h("th", null, "채보"), h("th", null, "수정일"), h("th")),
        ),
        h(
          "tbody",
          null,
          ...entries.map(({ song, charts }) =>
            h(
              "tr",
              { class: "clickable", onclick: () => app.go(new EditorScene(app, song.id)) },
              h("td", null, h("strong", null, song.title), song.artist ? h("small", null, song.artist) : null),
              h("td", { class: "num" }, formatTime(song.durationSec)),
              h("td", { class: "num" }, String(song.beats.length)),
              h("td", { class: "num" }, String(charts.length)),
              h("td", { class: "num" }, formatDate(song.updatedAt)),
              h(
                "td",
                { class: "actions", onclick: (e: Event) => e.stopPropagation() },
                iconButton("download", "내보내기", () => void exportSong(song, exportCharts)),
                iconButton("trash", "삭제", async () => {
                  const extra = charts.length ? ` 채보 ${charts.length}개도 함께 지워져요.` : "";
                  if (!confirm(`"${song.title}"을(를) 지울까요?${extra}`)) return;
                  await deleteSong(song.id);
                  void this.render();
                }),
              ),
            ),
          ),
        ),
      ),
    );
  }

  private async import(files: File[]) {
    if (!files.length) return;
    const { app } = this;
    this.message.replaceChildren(h("span", { class: "spinner" }), h("span", null, "가져오는 중…"));
    const res = await importFiles(files, app.audio.ctx, (title) =>
      confirm(`"${title}"이(가) 이미 있어요. 덮어쓸까요?\n취소하면 사본으로 추가해요.`),
    );
    setChildren(this.message,
      res.songs.length ? h("span", null, `${res.songs.length}곡 추가됨`) : null,
      ...res.errors.map((e) => h("span", { class: "warn" }, e)),
    );
    // 음악 하나만 넣었으면 바로 박자 편집으로
    if (res.songs.length === 1 && !res.errors.length && !res.songs[0].beats.length && this.root.isConnected) {
      app.go(new EditorScene(app, res.songs[0].id));
      return;
    }
    void this.render();
  }
}
