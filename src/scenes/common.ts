import type { App, Scene } from "../app";
import type { Song, SongEntry } from "../data/library";
import type { Chart } from "../game/chart";
import { GRADES, type PlayResult } from "../game/scoring";
import { BONES, DIFFICULTIES, DIFFICULTY_JOINTS, DIFFICULTY_LABEL, type Difficulty } from "../pose/joints";
import { formatDate, formatTime, h, segmented } from "../ui";

/** 간단한 화면: enter에서 그리기만 하는 Scene */
export function screen(render: (root: HTMLElement) => void, extra: Partial<Scene> = {}): Scene {
  return { enter: render, ...extra };
}

/** 비동기로 데이터를 읽은 뒤 그리는 화면 */
export function asyncScreen(load: (root: HTMLElement) => Promise<void>, extra: Partial<Scene> = {}): Scene {
  return screen((root) => {
    load(root).catch((err: unknown) => {
      console.error(err);
      root.replaceChildren(h("div", { class: "panel" }, h("p", { class: "warn" }, `불러오기 실패: ${String(err)}`)));
    });
  }, extra);
}

export function difficultyPicker(value: Difficulty, onChange: (d: Difficulty) => void) {
  return segmented(
    DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABEL[d], sub: `관절 ${DIFFICULTY_JOINTS[d].length}` })),
    value,
    onChange,
  );
}

export const songInfo = (song: Song) =>
  [song.artist, formatTime(song.durationSec), `박자 ${song.beats.length}`].filter(Boolean).join(" · ");

export const chartInfo = (chart: Chart) => `포즈 ${chart.keyframes.length} · ${formatDate(chart.createdAt)}`;

/** 게임에 쓸 수 있는 곡 (박자가 있는 곡) 목록 */
export function songList(entries: SongEntry[], onPick: (e: SongEntry) => void, selectedId?: string) {
  return h(
    "div",
    { class: "list" },
    ...entries.map((e) =>
      h(
        "button",
        { class: `list-row${e.song.id === selectedId ? " selected" : ""}`, onclick: () => onPick(e) },
        h("span", { class: "list-title" }, e.song.title),
        h("span", { class: "list-meta" }, songInfo(e.song)),
      ),
    ),
  );
}

/** 라이브러리가 비었을 때 안내 */
export function emptyLibrary(text: string) {
  return h("div", { class: "empty" }, text, h("br"), "타이틀의 채보 에디터에서 곡을 추가하거나 파일을 가져오세요.");
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
    h("div", { class: "stat" }, h("small", null, "최대 콤보"), h("strong", null, String(result.maxCombo))),
    h("div", { class: "stat" }, h("small", null, "정확도"), h("strong", null, `${Math.round(result.accuracy * 100)}%`)),
  );
}

export function rankOf(accuracy: number) {
  if (accuracy >= 0.9) return "S";
  if (accuracy >= 0.8) return "A";
  if (accuracy >= 0.65) return "B";
  if (accuracy >= 0.5) return "C";
  return "D";
}

/** 포즈 미리보기 (작은 막대 인형) */
export function poseThumb(pose: [number, number][], size = 44) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  // 정규화 좌표: 원점 = 엉덩이, 몸통 = 1. 대략 x ±1.6, y -2.2 ~ 1.9
  svg.setAttribute("viewBox", "-1.7 -2.3 3.4 4.3");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(Math.round((size * 4.3) / 3.4)));
  svg.classList.add("pose-thumb");
  // 화면은 거울 반전으로 보여주므로 x를 뒤집는다
  for (const [a, b] of BONES) {
    const l = document.createElementNS(NS, "line");
    l.setAttribute("x1", String(-pose[a][0]));
    l.setAttribute("y1", String(pose[a][1]));
    l.setAttribute("x2", String(-pose[b][0]));
    l.setAttribute("y2", String(pose[b][1]));
    svg.append(l);
  }
  const head = document.createElementNS(NS, "circle");
  head.setAttribute("cx", String(-pose[0][0]));
  head.setAttribute("cy", String(pose[0][1]));
  head.setAttribute("r", "0.22");
  svg.append(head);
  return svg;
}

let initPromise: Promise<void> | null = null;

/** 카메라 + 포즈 모델 준비 (한 번만) */
export function initTracker(app: App): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await app.tracker.startCamera();
      await app.tracker.loadModel(app.settings.model, app.settings.forceCpu);
      app.tracker.start();
      app.stage.resize();
    })();
    initPromise.catch(() => (initPromise = null));
  }
  return initPromise;
}

/** 카메라·모델 준비 후 실행 (에디터처럼 처음부터 카메라가 필요 없는 화면용) */
export async function withTracker(app: App, run: () => void) {
  try {
    await initTracker(app);
    run();
  } catch (err) {
    alert(`카메라를 준비할 수 없어요: ${err instanceof Error ? err.message : String(err)}`);
  }
}
