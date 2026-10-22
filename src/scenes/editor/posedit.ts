import {
  BOUNDS,
  HANDLE_JOINTS,
  clampPoint,
  mirrorPose,
  moveJoint,
  parentOf,
  renormalize,
  rotateJoint,
  roundPose,
  samePose,
  type PackedPose,
} from "../../pose/edit";
import { BONES } from "../../pose/joints";

const NS = "http://www.w3.org/2000/svg";
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** 박자 하나의 편집 기록 */
interface History {
  original: PackedPose;
  undo: PackedPose[];
  redo: PackedPose[];
}

/**
 * 채보 포즈 편집기: 관절 손잡이를 끌어서 포즈를 고친다.
 * - 화면처럼 좌우 반전해서 보여 준다 (저장 좌표는 반전 전)
 * - 기본은 뼈 길이 유지(부모 중심 회전), Shift 또는 freeMove면 자유 이동
 * - 놓을 때마다 다시 정규화해서 onCommit으로 알린다
 */
export class PoseEditor {
  readonly el: SVGSVGElement;
  /** 뼈 길이 유지 해제 */
  freeMove = false;
  onCommit: (pose: PackedPose) => void = () => {};

  private pose: PackedPose = [];
  private index = -1;
  private histories = new Map<number, History>();
  private judged = new Set<number>();
  private onion = svgEl("g", { class: "pe-onion" });
  private bones = svgEl("g", { class: "pe-bones" });
  private handles = svgEl("g", { class: "pe-handles" });
  private drag: { joint: number; start: PackedPose; pointer: number } | null = null;

  constructor() {
    const pad = 0.2;
    const w = BOUNDS.maxX - BOUNDS.minX + pad * 2;
    const h = BOUNDS.maxY - BOUNDS.minY + pad * 2;
    this.el = svgEl("svg", {
      class: "pose-editor",
      viewBox: `${BOUNDS.minX - pad} ${BOUNDS.minY - pad} ${w} ${h}`,
      "aria-label": "포즈 편집기",
    });
    // 바닥선 · 엉덩이 높이 안내선
    const guides = svgEl("g", { class: "pe-guides" });
    guides.append(
      svgEl("rect", { x: BOUNDS.minX, y: BOUNDS.minY, width: BOUNDS.maxX - BOUNDS.minX, height: BOUNDS.maxY - BOUNDS.minY, rx: 0.08 }),
      svgEl("line", { x1: BOUNDS.minX, y1: 0, x2: BOUNDS.maxX, y2: 0 }),
      svgEl("line", { x1: 0, y1: BOUNDS.minY, x2: 0, y2: BOUNDS.maxY }),
    );
    this.el.append(guides, this.onion, this.bones, this.handles);

    this.el.addEventListener("pointermove", (e) => this.move(e));
    this.el.addEventListener("pointerup", (e) => this.end(e));
    this.el.addEventListener("pointercancel", (e) => this.end(e));
  }

  /** 박자 index의 포즈를 연다. prev는 흐리게 겹쳐 보여 줄 이전 박자 포즈 */
  open(index: number, pose: PackedPose, prev: PackedPose | null) {
    this.drag = null;
    this.index = index;
    this.pose = pose;
    if (!this.histories.has(index)) this.histories.set(index, { original: pose, undo: [], redo: [] });
    this.onion.replaceChildren(...(prev ? this.boneLines(prev) : []));
    this.render();
  }

  /** 판정 관절 강조 (빈 배열이면 강조 없음) */
  setJudged(joints: number[]) {
    this.judged = new Set(joints);
    this.render();
  }

  get canUndo() {
    return !!this.history?.undo.length;
  }

  get canRedo() {
    return !!this.history?.redo.length;
  }

  get changed() {
    const h = this.history;
    return !!h && !samePose(h.original, this.pose);
  }

  undo() {
    const h = this.history;
    const prev = h?.undo.pop();
    if (!h || !prev) return;
    h.redo.push(this.pose);
    this.set(prev);
  }

  redo() {
    const h = this.history;
    const next = h?.redo.pop();
    if (!h || !next) return;
    h.undo.push(this.pose);
    this.set(next);
  }

  /** 이 박자를 처음 열었을 때 포즈로 */
  reset() {
    const h = this.history;
    if (h && !samePose(h.original, this.pose)) this.apply(h.original);
  }

  mirror() {
    this.apply(mirrorPose(this.pose));
  }

  /** 바깥(라이브러리 드롭다운 등)에서 포즈를 바꿨을 때: 되돌리기 기록에 남긴다 */
  replace(pose: PackedPose) {
    const h = this.history;
    if (h) {
      h.undo.push(this.pose);
      h.redo = [];
    }
    this.pose = pose;
    this.render();
  }

  private get history() {
    return this.histories.get(this.index);
  }

  /** 새 포즈를 적용 (되돌리기 기록 + 저장) */
  private apply(pose: PackedPose) {
    const h = this.history;
    if (!h) return;
    h.undo.push(this.pose);
    h.redo = [];
    this.set(pose);
  }

  private set(pose: PackedPose) {
    this.pose = pose;
    this.render();
    this.onCommit(pose);
  }

  // ---- 그리기 ----

  /** 저장 좌표 → 화면 좌표 (좌우 반전) */
  private boneLines(pose: PackedPose) {
    return BONES.map(([a, b]) => svgEl("line", { x1: -pose[a][0], y1: pose[a][1], x2: -pose[b][0], y2: pose[b][1] }));
  }

  private render() {
    const p = this.pose;
    if (!p.length) return;
    this.bones.replaceChildren(
      ...this.boneLines(p),
      svgEl("circle", { class: "pe-face", cx: -p[0][0], cy: p[0][1], r: 0.22 }),
    );
    this.handles.replaceChildren(
      ...HANDLE_JOINTS.map((j) => {
        const g = svgEl("g", {
          class: `pe-handle${this.judged.has(j) ? " judged" : ""}${this.drag?.joint === j ? " active" : ""}${
            parentOf(j) === undefined ? " root" : ""
          }`,
          transform: `translate(${-p[j][0]} ${p[j][1]})`,
        });
        // 보이는 점보다 넓게 잡히도록 투명한 큰 원을 깐다
        g.append(svgEl("circle", { class: "pe-hit", r: 0.14 }), svgEl("circle", { class: "pe-dot", r: 0.065 }));
        g.addEventListener("pointerdown", (e) => this.start(e, j));
        return g;
      }),
    );
  }

  // ---- 끌기 ----

  /** 포인터 위치 → 저장 좌표 */
  private toPose(e: PointerEvent): [number, number] {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(this.el.getScreenCTM()!.inverse());
    return clampPoint(-pt.x, pt.y);
  }

  private start(e: PointerEvent, joint: number) {
    if (e.button !== 0 || this.drag) return;
    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    this.drag = { joint, start: this.pose, pointer: e.pointerId };
    this.render();
  }

  private move(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    const [x, y] = this.toPose(e);
    const free = this.freeMove || e.shiftKey;
    this.pose = (free ? moveJoint : rotateJoint)(d.start, d.joint, x, y);
    this.render();
  }

  private end(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    this.drag = null;
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    const result = roundPose(renormalize(this.pose));
    if (samePose(result, d.start)) {
      this.pose = d.start;
      this.render();
      return;
    }
    this.pose = d.start;
    this.apply(result);
  }
}
