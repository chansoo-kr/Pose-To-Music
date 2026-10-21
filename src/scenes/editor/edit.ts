import type { App, Scene } from "../../app";
import { MIN_GAP, detectTempo, gridBeats, minGap } from "../../audio/beat";
import { exportSong } from "../../data/io";
import { getSong, listCharts, loadAudio, saveSong, type Song } from "../../data/library";
import { button, formatTimeMs, h, icon, iconButton, segmented, setChildren } from "../../ui";
import { BeatModel } from "./beats";
import { ChartsTab } from "./charts";
import { EditorListScene } from "./list";
import { BeatTrack } from "./waveform";

export type EditorTab = "beats" | "charts";

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;

/** 곡 하나 편집: [박자] 파형 위에 박자 찍기 / [채보] 채보 관리 */
export class EditorScene implements Scene {
  private app: App;
  private songId: string;
  private tab: EditorTab;
  private alive = true;

  private song!: Song;
  private buffer!: AudioBuffer;
  private model!: BeatModel;
  private track!: BeatTrack;
  private metaDirty = false;

  private playing = false;
  private rate = 1;
  private clicks = true;
  private nextClick = 0;
  private timeEl = h("span", { class: "time" });
  private playBtn!: HTMLButtonElement;
  private statusEl = h("div", { class: "editor-status" });
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private chartsCount = 0;
  private body = h("div", { class: "editor-body" });
  private tabsEl = h("div");
  private grid: HTMLElement | null = null;
  private onKey = (e: KeyboardEvent) => this.key(e);
  private onUnload = (e: BeforeUnloadEvent) => {
    if (this.dirty) e.preventDefault();
  };

  constructor(app: App, songId: string, tab: EditorTab = "beats") {
    this.app = app;
    this.songId = songId;
    this.tab = tab;
  }

  enter(root: HTMLElement) {
    void this.load(root);
  }

  exit() {
    this.alive = false;
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("beforeunload", this.onUnload);
  }

  private get dirty() {
    return (this.model?.dirty ?? false) || this.metaDirty;
  }

  private async load(root: HTMLElement) {
    const { app } = this;
    const loading = h("div", { class: "loading-pill" }, h("span", { class: "spinner" }), "곡 불러오는 중…");
    root.append(loading);
    const song = await getSong(this.songId);
    if (!song) return app.go(new EditorListScene(app));
    this.song = song;
    try {
      this.buffer = await loadAudio(song, app.audio.ctx);
    } catch {
      loading.remove();
      root.append(h("div", { class: "panel" }, h("p", { class: "warn" }, "음악 파일을 읽을 수 없어요.")));
      return;
    }
    this.chartsCount = (await listCharts(song.id)).length;
    loading.remove();
    if (!this.alive) return;

    this.model = new BeatModel(song.beats);
    this.track = new BeatTrack(this.buffer, this.model);
    this.track.onSeek = (t) => this.seek(t);
    this.model.onChange = () => {
      this.track.draw();
      this.renderStatus();
      if (this.playing) this.resetClicks(this.app.audio.songTime() + 0.05);
    };

    const title = h("input", {
      class: "title-input",
      value: song.title,
      maxLength: 80,
      placeholder: "제목",
      oninput: (e: Event) => {
        this.song.title = (e.target as HTMLInputElement).value.trim() || "제목 없음";
        this.metaDirty = true;
      },
    });
    const artist = h("input", {
      value: song.artist,
      maxLength: 80,
      placeholder: "아티스트 (선택)",
      oninput: (e: Event) => {
        this.song.artist = (e.target as HTMLInputElement).value.trim();
        this.metaDirty = true;
      },
    });

    root.append(
      h(
        "div",
        { class: "page editor" },
        h(
          "header",
          { class: "editor-top" },
          iconButton("back", "곡 목록", () => this.leave()),
          h("div", { class: "editor-meta" }, title, artist),
          button("내보내기", () => void this.exportNow(), "", "download"),
          button("저장", () => void this.save(), "primary", "save"),
        ),
        this.tabsEl,
        this.body,
      ),
    );
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("beforeunload", this.onUnload);
    this.renderTabs();
    this.renderBody();
  }

  private renderTabs() {
    this.tabsEl.replaceChildren(
      segmented<EditorTab>(
        [
          { value: "beats", label: `박자 ${this.model.beats.length}` },
          { value: "charts", label: `채보 ${this.chartsCount}` },
        ],
        this.tab,
        (t) => {
          this.tab = t;
          this.pause();
          this.renderBody();
        },
      ),
    );
    this.tabsEl.firstElementChild!.classList.add("tabs");
  }

  private renderBody() {
    if (this.tab === "charts") {
      this.body.replaceChildren(
        new ChartsTab(this.app, this.song, this.dirty, (n) => {
          this.chartsCount = n;
          this.renderTabs();
        }).el,
      );
      return;
    }

    this.playBtn = h("button", { class: "btn icon-only", title: "재생 / 정지 (Space)", onclick: () => this.toggle() });
    this.undoBtn = iconButton("undo", "되돌리기 (Ctrl+Z)", () => this.model.undo());
    this.redoBtn = iconButton("redo", "다시 하기 (Ctrl+Shift+Z)", () => this.model.redo());
    const clickBox = h("input", {
      type: "checkbox",
      checked: this.clicks,
      onchange: (e: Event) => (this.clicks = (e.target as HTMLInputElement).checked),
    });

    this.body.replaceChildren(
      this.track.el,
      h(
        "div",
        { class: "toolbar" },
        this.playBtn,
        this.timeEl,
        h("span", { class: "sep" }),
        h("span", { class: "muted" }, "속도"),
        segmented(
          [0.5, 0.75, 1].map((v) => ({ value: v, label: `${v}x` })),
          this.rate,
          (v) => {
            this.rate = v;
            if (this.playing) {
              this.pause();
              this.play();
            }
          },
        ),
        h("label", { class: "check" }, clickBox, "클릭음"),
        h("span", { class: "sep" }),
        iconButton("minus", "축소 (Ctrl+휠)", () => this.track.zoom(1 / 1.5)),
        iconButton("plus", "확대 (Ctrl+휠)", () => this.track.zoom(1.5)),
      ),
      h(
        "div",
        { class: "toolbar" },
        button("박자 추가 (B)", () => this.model.add(this.track.playhead), "", "plus"),
        button("그리드로 채우기", () => this.toggleGrid()),
        button("선택 삭제", () => this.model.removeSelected(), "", "trash"),
        button("전체 삭제", () => {
          if (confirm("박자를 모두 지울까요?")) this.model.clear();
        }),
        h("span", { class: "sep" }),
        this.undoBtn,
        this.redoBtn,
      ),
      h("div", { class: "grid-slot" }),
      this.statusEl,
      h(
        "p",
        { class: "hint" },
        "재생 중 B 또는 Enter를 누르면 그 시점에 박자가 찍혀요. 파형 빈 곳 클릭 = 박자 추가, 드래그 = 범위 선택, 마커 드래그 = 이동, " +
          "←/→ = 선택한 박자 10ms 이동(Shift 100ms), Delete = 삭제, 위쪽 눈금 클릭 = 재생 위치, Ctrl+휠 = 확대.",
      ),
    );
    this.grid = null;
    this.renderStatus();
    this.updateTransport();
    requestAnimationFrame(() => this.track.draw());
  }

  private renderStatus() {
    if (this.tab !== "beats") return;
    const { beats, selected } = this.model;
    const gap = minGap(beats);
    const warns: string[] = [];
    if (gap < MIN_GAP) warns.push(`가장 짧은 간격 ${gap.toFixed(2)}s — 포즈를 바꾸기 빠듯해요 (노란 마커)`);
    if (beats.length && beats[0] < 2) warns.push("첫 박자가 2초 전이에요 — 게임에서는 앞에 대기 시간이 붙어요");
    setChildren(this.statusEl,
      h("span", null, `박자 ${beats.length}개`),
      selected.size ? h("span", null, `선택 ${selected.size}개`) : null,
      Number.isFinite(gap) && gap >= MIN_GAP ? h("span", null, `가장 짧은 간격 ${gap.toFixed(2)}s`) : null,
      ...warns.map((w) => h("span", { class: "warn" }, w)),
      this.dirty ? h("span", { class: "muted" }, "저장 안 됨") : null,
    );
    this.undoBtn.disabled = !this.model.canUndo;
    this.redoBtn.disabled = !this.model.canRedo;
    this.renderTabs();
  }

  // ---- 그리드로 채우기 ----

  private toggleGrid() {
    const slot = this.body.querySelector(".grid-slot")!;
    if (this.grid) {
      this.grid.remove();
      this.grid = null;
      return;
    }
    const sel = [...this.model.selected].sort((a, b) => a - b);
    const num = (value: number, step: number) => h("input", { type: "number", value, step, min: 0 });
    const bpm = num(120, 0.1);
    const start = num(Math.round((sel[0] ?? this.track.playhead) * 1000) / 1000, 0.001);
    const end = num(Math.round((sel.length > 1 ? sel[sel.length - 1] : this.buffer.duration) * 1000) / 1000, 0.001);
    let every = 2;
    const replace = h("input", { type: "checkbox", checked: true });
    const detectBtn = button("BPM 추정", () => {
      const r = detectTempo(this.buffer);
      bpm.value = String(r.bpm);
      if (!sel.length) start.value = String(r.offset);
    });

    this.grid = h(
      "div",
      { class: "grid-panel" },
      h("label", { class: "field" }, h("span", null, "BPM"), bpm),
      detectBtn,
      h("label", { class: "field" }, h("span", null, "시작(초)"), start),
      h("label", { class: "field" }, h("span", null, "끝(초)"), end),
      h(
        "div",
        { class: "field" },
        h("span", null, "간격"),
        segmented(
          [1, 2, 4, 8].map((v) => ({ value: v, label: `${v}박` })),
          every,
          (v) => (every = v),
        ),
      ),
      h("label", { class: "check" }, replace, "구간 안의 기존 박자 지우기"),
      button(
        "채우기",
        () => {
          const a = Number(start.value);
          const b = Number(end.value);
          const generated = gridBeats(Number(bpm.value), a, Math.min(b, this.buffer.duration), every);
          if (!generated.length) return;
          const keep = replace.checked ? this.model.beats.filter((t) => t < a - 1e-6 || t > b + 1e-6) : this.model.beats;
          this.model.commit([...keep, ...generated], generated);
        },
        "primary",
      ),
    );
    slot.append(this.grid);
  }

  // ---- 재생 ----

  private seek(t: number) {
    const was = this.playing;
    if (was) this.pause();
    this.track.playhead = t;
    if (was) this.play();
    this.updateTransport();
    this.track.draw();
  }

  private toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  private play() {
    if (this.track.playhead >= this.buffer.duration - 0.05) this.track.playhead = 0;
    this.app.audio.play(this.buffer, {
      from: this.track.playhead,
      rate: this.rate,
      onEnded: () => {
        this.playing = false;
        this.track.playhead = this.buffer.duration;
        this.updateTransport();
      },
    });
    this.playing = true;
    this.resetClicks(this.track.playhead);
    this.updateTransport();
  }

  private pause() {
    if (!this.playing) return;
    this.track.playhead = Math.max(0, Math.min(this.buffer.duration, this.app.audio.songTime()));
    this.app.audio.stop();
    this.playing = false;
    this.updateTransport();
  }

  private resetClicks(from: number) {
    this.nextClick = this.model.beats.findIndex((b) => b >= from);
    if (this.nextClick < 0) this.nextClick = this.model.beats.length;
  }

  private updateTransport() {
    if (!this.playBtn) return;
    this.playBtn.replaceChildren(icon(this.playing ? "pause" : "play", 18));
    this.timeEl.textContent = `${formatTimeMs(this.track.playhead)} / ${formatTimeMs(this.buffer.duration)}`;
  }

  update() {
    if (!this.playing || this.tab !== "beats") return;
    const now = this.app.audio.songTime();
    this.track.playhead = Math.max(0, now);
    // 클릭음은 조금 앞서 예약
    const beats = this.model.beats;
    while (this.nextClick < beats.length && beats[this.nextClick] < now + 0.15 * this.rate) {
      if (this.clicks && beats[this.nextClick] >= now - 0.02) this.app.audio.clickAt(beats[this.nextClick]);
      this.nextClick++;
    }
    this.track.follow();
    this.track.draw();
    this.timeEl.textContent = `${formatTimeMs(this.track.playhead)} / ${formatTimeMs(this.buffer.duration)}`;
  }

  // ---- 키보드 ----

  private key(e: KeyboardEvent) {
    if (this.tab !== "beats" || isTyping(e.target)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    // 버튼에 포커스가 있으면 Space/Enter가 버튼을 누르지 않도록
    if (document.activeElement instanceof HTMLButtonElement && (k === " " || k === "Enter")) {
      document.activeElement.blur();
    }

    if (k === " ") this.toggle();
    else if (k === "b" || k === "B" || k === "Enter") {
      const t = this.playing
        ? this.app.audio.songTime() - (this.app.settings.tapOffsetMs / 1000) * this.rate
        : this.track.playhead;
      this.model.add(Math.max(0, t));
    } else if (k === "Delete" || k === "Backspace") this.model.removeSelected();
    else if (k === "ArrowLeft" || k === "ArrowRight") {
      const d = (k === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01);
      if (this.model.selected.size) this.model.nudge(d, this.buffer.duration);
      else this.seek(Math.max(0, Math.min(this.buffer.duration, this.track.playhead + d * 100)));
    } else if (ctrl && (k === "z" || k === "Z")) {
      if (e.shiftKey) this.model.redo();
      else this.model.undo();
    } else if (ctrl && (k === "y" || k === "Y")) this.model.redo();
    else if (ctrl && (k === "a" || k === "A")) this.model.select(this.model.beats);
    else if (ctrl && (k === "s" || k === "S")) void this.save();
    else if (k === "Escape") this.model.select([]);
    else if (k === "Home") this.seek(0);
    else return;
    e.preventDefault();
  }

  // ---- 저장 / 나가기 ----

  private async save() {
    const beatsChanged = this.model.dirty;
    this.song.beats = this.model.beats;
    this.song.updatedAt = Date.now();
    await saveSong(this.song);
    this.model.dirty = false;
    this.metaDirty = false;
    this.renderStatus();
    if (beatsChanged && this.chartsCount)
      this.statusEl.append(h("span", { class: "muted" }, `저장됨 · 기존 채보 ${this.chartsCount}개는 예전 타이밍을 유지해요`));
    else this.statusEl.append(h("span", { class: "muted" }, "저장됨"));
  }

  private async exportNow() {
    if (this.dirty) await this.save();
    await exportSong(this.song, true);
  }

  private leave() {
    if (this.dirty && !confirm("저장하지 않은 변경이 있어요. 저장하지 않고 나갈까요?")) return;
    this.app.go(new EditorListScene(this.app));
  }
}
