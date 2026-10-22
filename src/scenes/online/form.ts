import type { Scene } from "../../app";
import { listLibrary, type Song, type SongEntry } from "../../data/library";
import type { Chart } from "../../game/chart";
import { LENIENCIES, LENIENCY_LABEL, type Leniency } from "../../game/scoring";
import { MAX_PLAYERS, MAX_SONG_BYTES, MIN_PLAYERS } from "../../net/config";
import { ROOM_NAME_MAX, type GameMode } from "../../net/protocol";
import type { Difficulty } from "../../pose/joints";
import { button, h, label, panel, panelHeader, segmented } from "../../ui";
import { chartList } from "../classic";
import { asyncScreen, difficultyPicker, emptyLibrary, songInfo } from "../common";

export interface RoomFormValues {
  name: string;
  max: number;
  mode: GameMode;
  level: Difficulty;
  leniency: Leniency;
  password: string;
  songId: string | null;
  chartId: string | null;
}

export interface RoomFormOptions {
  title: string;
  submitLabel: string;
  initial: RoomFormValues;
  /** 설정 바꾸기: 비밀번호는 못 바꾸고, 인원은 지금 인원보다 줄일 수 없다 */
  editing?: { players: number };
  onSubmit(values: RoomFormValues, song: Song, chart: Chart | null): Promise<void>;
  onBack(): void;
}

const MB = 1024 * 1024;

/** 방 설정 폼 (방 만들기 / 설정 바꾸기) */
export function roomFormScene(opts: RoomFormOptions): Scene {
  return asyncScreen(async (root) => {
    const entries = (await listLibrary()).filter((e) => e.song.beats.length);
    const v = { ...opts.initial };
    const minMax = Math.max(MIN_PLAYERS, opts.editing?.players ?? 0);
    v.max = Math.max(v.max, minMax);

    const songsBox = h("div");
    const chartsBox = h("div");
    const error = h("p", { class: "warn" });
    const submit = button(opts.submitLabel, () => void send(), "primary big", "arrow");

    const usable = (e: SongEntry) => (v.mode === "classic" ? e.charts.length > 0 : true);
    const current = () => entries.find((e) => e.song.id === v.songId && usable(e));

    const renderSongs = () => {
      const list = entries.filter(usable);
      if (!list.length) {
        songsBox.replaceChildren(
          emptyLibrary(v.mode === "classic" ? "채보가 있는 곡이 없어요." : "박자가 있는 곡이 없어요."),
        );
      } else {
        songsBox.replaceChildren(
          h(
            "div",
            { class: "list" },
            ...list.map((e) => {
              const tooBig = e.song.audio.size > MAX_SONG_BYTES;
              return h(
                "button",
                {
                  class: `list-row${e.song.id === v.songId ? " selected" : ""}`,
                  disabled: tooBig,
                  title: tooBig ? "30MB가 넘는 곡은 온라인으로 보낼 수 없어요" : undefined,
                  onclick: () => {
                    v.songId = e.song.id;
                    if (!e.charts.some((c) => c.id === v.chartId)) v.chartId = e.charts[0]?.id ?? null;
                    render();
                  },
                },
                h("span", { class: "list-title" }, e.song.title),
                h(
                  "span",
                  { class: "list-meta" },
                  tooBig ? `${(e.song.audio.size / MB).toFixed(0)}MB · 너무 커요` : songInfo(e.song),
                ),
              );
            }),
          ),
        );
      }
    };

    const renderCharts = () => {
      const e = current();
      if (v.mode !== "classic" || !e) return chartsBox.replaceChildren();
      chartsBox.replaceChildren(
        label("채보"),
        chartList(
          e.charts,
          (c) => {
            v.chartId = c.id;
            renderCharts();
            refresh();
          },
          v.chartId ?? undefined,
        ),
      );
    };

    const refresh = () => {
      const e = current();
      submit.disabled = !e || (v.mode === "classic" && !e.charts.some((c) => c.id === v.chartId));
    };

    const render = () => {
      renderSongs();
      renderCharts();
      refresh();
    };

    const send = async () => {
      const e = current();
      if (!e) return;
      const chart = v.mode === "classic" ? (e.charts.find((c) => c.id === v.chartId) ?? null) : null;
      v.name = v.name.trim() || opts.initial.name;
      submit.disabled = true;
      error.textContent = "";
      try {
        await opts.onSubmit(v, e.song, chart);
      } catch (err) {
        console.error(err);
        error.textContent = `실패: ${err instanceof Error ? err.message : String(err)}`;
        submit.disabled = false;
      }
    };

    const maxItems = [];
    for (let n = minMax; n <= MAX_PLAYERS; n++) maxItems.push({ value: n, label: `${n}명` });

    const el = panel(
      panelHeader(opts.title, { onBack: opts.onBack }),
      h(
        "div",
        { class: "form-grid" },
        h(
          "label",
          { class: "field" },
          "방 이름",
          h("input", {
            type: "text",
            value: v.name,
            maxLength: ROOM_NAME_MAX,
            oninput: (e: Event) => (v.name = (e.target as HTMLInputElement).value),
          }),
        ),
        opts.editing
          ? null
          : h(
              "label",
              { class: "field" },
              "비밀번호 (선택)",
              h("input", {
                type: "password",
                value: v.password,
                maxLength: 32,
                placeholder: "비우면 공개방",
                autocomplete: "new-password",
                oninput: (e: Event) => (v.password = (e.target as HTMLInputElement).value),
              }),
            ),
      ),
      label("인원"),
      segmented(maxItems, v.max, (n) => (v.max = n)),
      label("게임 모드"),
      segmented<GameMode>(
        [
          { value: "classic", label: "기본", sub: "같은 채보로 대결" },
          { value: "freestyle", label: "프리스타일", sub: "녹화 → 교환 → 플레이" },
        ],
        v.mode,
        (m) => {
          v.mode = m;
          render();
        },
      ),
      label("난이도"),
      difficultyPicker(v.level, (d) => (v.level = d)),
      label("판정 여유"),
      segmented(
        LENIENCIES.map((x) => ({ value: x, label: LENIENCY_LABEL[x] })),
        v.leniency,
        (x) => (v.leniency = x),
      ),
      label("곡"),
      songsBox,
      chartsBox,
      error,
      h("div", { class: "row form-actions" }, submit),
    );
    el.classList.add("wide", "game-panel");
    root.append(el);
    render();
  });
}
