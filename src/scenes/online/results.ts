import type { Scene } from "../../app";
import { findSongByHash } from "../../data/library";
import type { Chart } from "../../game/chart";
import { DIFFICULTY_LABEL } from "../../pose/joints";
import { button, h, icon, panel, panelHeader } from "../../ui";
import { rankOf, resultTable } from "../common";
import { MODE_LABEL } from "./lobby";
import type { OnlineSession } from "./session";

/** 다른 사람을 기다리는 화면 (녹화 수집 / 결과 집계) */
export class WaitScene implements Scene {
  private session: OnlineSession;
  private text: string;

  constructor(session: OnlineSession, text: string) {
    this.session = session;
    this.text = text;
  }

  enter(root: HTMLElement) {
    const el = panel(
      h("div", { class: "wait" }, h("span", { class: "spinner big" }), h("strong", null, this.text)),
      h("div", { class: "row" }, button("나가기", () => this.session.exit(), "small", "back")),
    );
    el.classList.add("game-panel");
    root.append(el);
  }
}

/** 순위 발표 */
export class ResultsScene implements Scene {
  private session: OnlineSession;

  constructor(session: OnlineSession) {
    this.session = session;
  }

  enter(root: HTMLElement) {
    const { session } = this;
    const { net } = session;
    const rank = session.lastRank!;
    const s = net.state;
    const nameOf = (id: string | undefined) =>
      rank.rows.find((r) => r.id === id)?.name ?? net.member(id ?? "")?.name ?? "나간 사람";

    const played = rank.rows.filter((r) => r.result);
    // 프리스타일에서 아무도 채보를 못 냈으면 플레이 없이 넘어간 판
    const skipped = rank.mode === "freestyle" && rank.rows.every((r) => !r.from);
    const top = played[0]?.result?.score;
    const winners = played.filter((r) => r.result!.score === top);

    // 프리스타일: 채보별 평균 점수 → 가장 어려웠던 채보
    let hardest: HTMLElement | null = null;
    if (rank.mode === "freestyle") {
      const byOwner = new Map<string, number[]>();
      for (const r of played) if (r.from) byOwner.set(r.from, [...(byOwner.get(r.from) ?? []), r.result!.score]);
      const avg = [...byOwner].map(([id, list]) => ({ id, avg: list.reduce((a, b) => a + b, 0) / list.length }));
      avg.sort((a, b) => a.avg - b.avg);
      if (avg.length >= 2)
        hardest = h("p", { class: "muted" }, `가장 어려웠던 채보: ${nameOf(avg[0].id)}의 채보 (평균 ${Math.round(avg[0].avg).toLocaleString()}점)`);
    }

    const rows = rank.rows.map((r, i) =>
      h(
        "details",
        { class: `rank-row${r.id === net.selfId ? " me" : ""}${r.result && i < 3 ? ` place-${i + 1}` : ""}` },
        h(
          "summary",
          null,
          h("span", { class: "rank-pos" }, r.result ? `${i + 1}` : "-"),
          h(
            "span",
            { class: "rank-name" },
            r.name,
            r.from ? h("small", null, ` ${nameOf(r.from)}의 채보`) : null,
          ),
          h("span", { class: "rank-grade" }, r.result ? rankOf(r.result.accuracy) : ""),
          h("span", { class: "rank-score" }, r.result ? r.result.score.toLocaleString() : skipped ? "-" : "나감"),
        ),
        r.result ? resultTable(r.result) : null,
      ),
    );

    // 저장할 수 있는 것: 내가 녹화한 채보, 내가 따라 한 채보, (참가자) 받은 곡
    const charts: Chart[] = [];
    for (const c of [session.myChart, session.playedChart]) if (c && !charts.some((x) => x.id === c.id)) charts.push(c);
    if (net.isHost && rank.mode === "classic") charts.length = 0;
    const saveBox = h("span");
    const meta = s?.settings.song;
    if (meta && net.song) {
      void findSongByHash(meta.hash).then((local) => {
        if (!charts.length && local) return;
        const label = charts.length ? (local ? "채보 저장" : "곡·채보 저장") : "곡 저장";
        const save: HTMLButtonElement = button(
          label,
          async () => {
            save.disabled = true;
            try {
              const n = await session.saveCharts(charts);
              save.lastElementChild!.textContent = n ? `채보 ${n}개 저장됨` : "곡 저장됨";
            } catch (err) {
              console.error(err);
              save.lastElementChild!.textContent = "저장 실패";
              save.disabled = false;
            }
          },
          "",
          "save",
        );
        save.title = "내 라이브러리에 저장해서 싱글에서도 쓸 수 있어요";
        saveBox.append(save);
      });
    }

    const el = panel(
      panelHeader("결과", {
        sub: [MODE_LABEL[rank.mode], meta?.title, s ? DIFFICULTY_LABEL[s.settings.level] : ""].filter(Boolean).join(" · "),
      }),
      winners.length
        ? h(
            "div",
            { class: "winner" },
            icon("trophy", 22),
            h("span", null, winners.length > 1 ? "공동 1위" : "1위"),
            h("strong", null, winners.map((w) => w.name).join(", ")),
          )
        : h("p", { class: "muted" }, skipped ? "녹화된 채보가 없어서 이번 판은 넘어갔어요." : "플레이한 사람이 없어요."),
      h("div", { class: "ranking" }, ...rows),
      hardest,
      h(
        "div",
        { class: "row" },
        button("나가기", () => session.exit(), "small", "back"),
        saveBox,
        button("대기실로", () => session.openLobby(), "primary", "arrow"),
      ),
    );
    el.classList.add("game-panel");
    root.append(el);
  }
}
