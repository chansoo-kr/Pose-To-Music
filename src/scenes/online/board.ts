import { BONES } from "../../pose/joints";
import { h } from "../../ui";
import type { Overlay } from "../play";
import type { OnlineSession } from "./session";

const MINI_W = 48;
const MINI_H = 60;
/** 이보다 오래 소식이 없으면 미니뷰를 흐리게 */
const STALE_MS = 500;

interface Row {
  el: HTMLElement;
  score: HTMLElement;
  combo: HTMLElement;
  canvas: HTMLCanvasElement | null;
}

/**
 * 플레이·녹화 중 오른쪽 실시간 순위 보드.
 * 설정 "다른 사람 포즈 보기"가 켜져 있으면 다른 참가자의 스켈레톤 미니뷰를 붙인다.
 */
export function liveBoard(session: OnlineSession): Overlay {
  const { net, app } = session;
  const list = h("ol", { class: "live-list" });
  const el = h("aside", { class: "live-board" }, list);
  const rows = new Map<string, Row>();
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const rowOf = (id: string, name: string): Row => {
    let row = rows.get(id);
    if (!row) {
      const me = id === net.selfId;
      const canvas = !me && app.settings.showPeers ? h("canvas", { class: "mini-pose" }) : null;
      if (canvas) {
        canvas.width = MINI_W * dpr;
        canvas.height = MINI_H * dpr;
      }
      const score = h("strong", { class: "live-score" }, "0");
      const combo = h("small", { class: "live-combo" });
      row = {
        el: h(
          "li",
          { class: `live-row${me ? " me" : ""}` },
          canvas,
          h("div", { class: "live-info" }, h("span", { class: "live-name" }, name), score, combo),
        ),
        score,
        combo,
        canvas,
      };
      rows.set(id, row);
    }
    return row;
  };

  const draw = (canvas: HTMLCanvasElement, id: string, now: number) => {
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MINI_W, MINI_H);
    const entry = session.poses.get(id);
    if (!entry) return;
    const p = entry.pose;
    // 정규화 좌표: 원점 = 엉덩이, 몸통 = 1. 대략 x ±1.6, y -2.3 ~ 1.9. 화면처럼 거울 반전
    const scale = MINI_H / 4.4;
    const X = (i: number) => MINI_W / 2 - p[i][0] * scale;
    const Y = (i: number) => MINI_H * 0.53 + p[i][1] * scale;
    ctx.globalAlpha = now - entry.at > STALE_MS ? 0.3 : 1;
    ctx.strokeStyle = "#ececec";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const [a, b] of BONES) {
      ctx.moveTo(X(a), Y(a));
      ctx.lineTo(X(b), Y(b));
    }
    ctx.stroke();
    ctx.fillStyle = "#ff5a36";
    ctx.beginPath();
    ctx.arc(X(0), Y(0), 4, 0, Math.PI * 2);
    ctx.fill();
  };

  const render = () => {
    const now = performance.now();
    const members = net.members
      .map((m) => ({ m, live: session.live.get(m.id) }))
      .sort((a, b) => (b.live?.score ?? 0) - (a.live?.score ?? 0));
    const seen = new Set<string>();
    members.forEach(({ m, live }, i) => {
      seen.add(m.id);
      const row = rowOf(m.id, m.name);
      row.score.textContent = (live?.score ?? 0).toLocaleString();
      row.combo.textContent = live && live.combo >= 2 ? `${live.combo} 콤보` : "";
      if (row.canvas) draw(row.canvas, m.id, now);
      if (list.children[i] !== row.el) list.insertBefore(row.el, list.children[i] ?? null);
    });
    for (const [id, row] of rows) {
      if (!seen.has(id)) {
        row.el.remove();
        rows.delete(id);
      }
    }
  };

  render();
  const timer = window.setInterval(render, 100);
  return {
    el,
    dispose() {
      window.clearInterval(timer);
      el.remove();
    },
  };
}
