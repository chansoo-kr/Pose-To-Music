import type { App } from "../../app";
import { deleteChart, listCharts, saveChart, type Song } from "../../data/library";
import { libraryChart, libraryPose, type Chart, type Keyframe } from "../../game/chart";
import { POSE_LIBRARY } from "../../game/poses";
import { DIFFICULTIES, DIFFICULTY_JOINTS, DIFFICULTY_LABEL, type Difficulty } from "../../pose/joints";
import { button, formatTimeMs, h, iconButton } from "../../ui";
import { chartInfo, poseThumb, withTracker } from "../common";
import { RecordScene } from "../record";
import { EditorScene } from "./edit";
import { PoseEditor } from "./posedit";
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
    this.key = () => false;
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

  /** 포즈 편집 화면에서의 키 처리 (EditorScene이 넘겨 줌). @returns 처리했으면 true */
  key: (e: KeyboardEvent) => boolean = () => false;

  /**
   * 채보 하나: 왼쪽 박자별 포즈 목록 + 오른쪽 포즈 편집기.
   * 라이브러리에서 고르거나 관절을 끌어 고치면 바로 저장한다.
   */
  private renderDetail(chart: Chart) {
    const save = () => void saveChart(chart);
    const author = h("input", {
      type: "text",
      value: chart.author,
      maxLength: 12,
      onchange: (e: Event) => {
        chart.author = (e.target as HTMLInputElement).value.trim() || "이름 없음";
        save();
      },
    });

    const keyframes = chart.keyframes;
    const editor = new PoseEditor();
    let current = 0;
    /** 박자를 처음 열었을 때의 출처 (되돌려서 원래 포즈가 되면 표시도 되돌린다) */
    const origin = new Map<number, Pick<Keyframe, "lib" | "edited">>();

    // ---- 왼쪽: 박자별 목록 ----
    const poseSelect = (k: Keyframe, i: number): HTMLSelectElement => {
      const select: HTMLSelectElement = h(
        "select",
        {
          onclick: (e: Event) => e.stopPropagation(),
          onchange: () => {
            const idx = Number(select.value);
            k.pose = libraryPose(idx);
            k.lib = idx;
            delete k.edited;
            if (i === current) {
              editor.replace(k.pose);
              refreshTools();
            }
            refreshRow(i);
            save();
          },
        },
        k.lib === undefined
          ? h("option", { value: "", selected: true, disabled: true }, k.edited ? "직접 수정" : "녹화한 포즈")
          : null,
        ...POSE_LIBRARY.map((p, idx) => h("option", { value: idx, selected: k.lib === idx }, p.name)),
      );
      return select;
    };

    const rowOf = (k: Keyframe, i: number) =>
      h(
        "div",
        { class: `pose-row${i === current ? " selected" : ""}`, onclick: () => select(i) },
        h("span", { class: "pose-idx" }, String(i + 1)),
        h("span", { class: "pose-time" }, formatTimeMs(k.t)),
        h("span", { class: "thumb" }, poseThumb(k.pose)),
        poseSelect(k, i),
      );

    const rows = keyframes.map(rowOf);
    const list = h("div", { class: "pose-list" }, ...rows);
    const refreshRow = (i: number) => {
      const row = rowOf(keyframes[i], i);
      rows[i].replaceWith(row);
      rows[i] = row;
    };

    // ---- 오른쪽: 편집기 ----
    const title = h("strong", { class: "pe-title" });
    const prevBtn = button("이전", () => select(current - 1), "small", "back");
    const nextBtn = button("다음", () => select(current + 1), "small", "arrow");
    nextBtn.append(nextBtn.firstElementChild!); // 아이콘을 글자 뒤로
    const undoBtn = iconButton("undo", "되돌리기 (Ctrl+Z)", () => editor.undo());
    const redoBtn = iconButton("redo", "다시 (Ctrl+Shift+Z)", () => editor.redo());
    const resetBtn = button("원래대로", () => editor.reset(), "small", "refresh");
    const mirrorBtn = button("좌우 뒤집기", () => editor.mirror(), "small", "shuffle");
    const free = h("input", {
      type: "checkbox",
      onchange: (e: Event) => (editor.freeMove = (e.target as HTMLInputElement).checked),
    });
    const judgedPicker = h(
      "select",
      {
        onchange: (e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          editor.setJudged(v ? DIFFICULTY_JOINTS[v as Difficulty] : []);
        },
      },
      h("option", { value: "" }, "안 보기"),
      ...DIFFICULTIES.map((d) => h("option", { value: d }, DIFFICULTY_LABEL[d])),
    );

    const refreshTools = () => {
      title.textContent = `${current + 1} / ${keyframes.length} · ${formatTimeMs(keyframes[current].t)}`;
      prevBtn.disabled = current <= 0;
      nextBtn.disabled = current >= keyframes.length - 1;
      undoBtn.disabled = !editor.canUndo;
      redoBtn.disabled = !editor.canRedo;
      resetBtn.disabled = !editor.changed;
    };

    editor.onCommit = (pose) => {
      const k = keyframes[current];
      k.pose = pose;
      const o = origin.get(current);
      if (!editor.changed && o) {
        if (o.lib === undefined) delete k.lib;
        else k.lib = o.lib;
        if (o.edited) k.edited = true;
        else delete k.edited;
      } else {
        delete k.lib;
        k.edited = true;
      }
      refreshRow(current);
      refreshTools();
      save();
    };
    // 끌기·되돌리기 뒤 버튼 상태 갱신 (onCommit이 없는 경우도 있어서)
    editor.el.addEventListener("pointerup", () => refreshTools());

    const select = (i: number) => {
      if (i < 0 || i >= keyframes.length) return;
      rows[current]?.classList.remove("selected");
      current = i;
      if (!origin.has(i)) origin.set(i, { lib: keyframes[i].lib, edited: keyframes[i].edited });
      rows[i].classList.add("selected");
      rows[i].scrollIntoView({ block: "nearest" });
      editor.open(i, keyframes[i].pose, i > 0 ? keyframes[i - 1].pose : null);
      refreshTools();
    };

    this.key = (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key;
      if (k === "ArrowLeft" || k === "ArrowUp") select(current - 1);
      else if (k === "ArrowRight" || k === "ArrowDown") select(current + 1);
      else if (ctrl && (k === "z" || k === "Z")) e.shiftKey ? editor.redo() : editor.undo();
      else if (ctrl && (k === "y" || k === "Y")) editor.redo();
      else return false;
      refreshTools();
      return true;
    };

    const backToList = () => {
      this.key = () => false;
      void this.renderList();
    };

    this.el.replaceChildren(
      h(
        "div",
        { class: "toolbar" },
        button("채보 목록", backToList, "", "back"),
        h("label", { class: "field inline" }, h("span", null, "만든 사람"), author),
        button("미리보기", () => this.app.go(new PreviewScene(this.app, this.song, chart, this.backToEditor)), "", "eye"),
      ),
      h(
        "p",
        { class: "hint" },
        "관절을 끌어서 포즈를 고쳐요. 뼈 길이는 그대로 돌아가고, Shift를 누르고 끌면 자유롭게 옮겨요. 놓으면 바로 저장돼요. 그림은 화면에 보이는 방향(거울) 기준이고, 흐린 선은 이전 박자 포즈예요.",
      ),
      keyframes.length
        ? h(
            "div",
            { class: "pose-edit" },
            list,
            h(
              "div",
              { class: "pe-panel" },
              h("div", { class: "pe-head" }, title, h("div", { class: "pe-nav" }, prevBtn, nextBtn)),
              editor.el,
              h("div", { class: "pe-tools" }, undoBtn, redoBtn, resetBtn, mirrorBtn),
              h(
                "div",
                { class: "pe-options" },
                h("label", { class: "field inline" }, h("span", null, "판정 관절 보기"), judgedPicker),
                h("label", { class: "check" }, free, "뼈 길이 유지 해제"),
              ),
            ),
          )
        : h("div", { class: "empty" }, "포즈가 없는 채보예요."),
    );
    if (keyframes.length) select(0);
  }
}
