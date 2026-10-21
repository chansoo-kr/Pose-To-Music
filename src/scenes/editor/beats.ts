import { sortBeats } from "../../data/io";

/** 박자 목록 + 선택 + 되돌리기 */
export class BeatModel {
  beats: number[];
  /** 선택된 박자 (값으로 저장) */
  selected = new Set<number>();
  dirty = false;
  onChange: () => void = () => {};
  private undoStack: number[][] = [];
  private redoStack: number[][] = [];

  constructor(beats: number[]) {
    this.beats = sortBeats(beats);
  }

  /** 되돌리기 지점 저장 (드래그처럼 여러 번 set 하기 전에 한 번) */
  checkpoint() {
    this.undoStack.push(this.beats);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  /** 되돌리기 지점 없이 바꾼다 */
  set(next: number[], select?: number[]) {
    this.beats = sortBeats(next);
    if (select) this.selected = new Set(sortBeats(select));
    else for (const s of this.selected) if (!this.beats.includes(s)) this.selected.delete(s);
    this.dirty = true;
    this.onChange();
  }

  commit(next: number[], select?: number[]) {
    this.checkpoint();
    this.set(next, select);
  }

  add(t: number) {
    const v = Math.round(t * 1000) / 1000;
    if (v < 0 || this.beats.includes(v)) return;
    this.commit([...this.beats, v], [v]);
  }

  removeSelected() {
    if (!this.selected.size) return;
    this.commit(this.beats.filter((b) => !this.selected.has(b)), []);
  }

  clear() {
    if (this.beats.length) this.commit([], []);
  }

  /** 선택한 박자를 dt만큼 이동 */
  nudge(dt: number, max: number) {
    if (!this.selected.size) return;
    const moved = [...this.selected].map((b) => Math.min(max, Math.max(0, b + dt)));
    this.commit([...this.beats.filter((b) => !this.selected.has(b)), ...moved], moved);
  }

  select(values: number[], additive = false) {
    if (!additive) this.selected.clear();
    for (const v of values) this.selected.add(v);
    this.onChange();
  }

  toggle(v: number) {
    if (this.selected.has(v)) this.selected.delete(v);
    else this.selected.add(v);
    this.onChange();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.beats);
    this.set(prev);
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.beats);
    this.set(next);
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}
