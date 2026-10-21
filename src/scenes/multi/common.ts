import type { App } from "../../app";
import type { Chart } from "../../game/chart";
import { PLAYER_COLORS, type Match, type Player } from "../../game/match";
import { DIFFICULTY_LABEL } from "../../pose/joints";
import { button, h, icon, iconButton, panel, panelHeader } from "../../ui";
import { rankOf, resultTable, screen } from "../common";
import { PlayScene } from "../play";

const MAX_PLAYERS = 6;

/** 아바타 글자: 기본 이름("플레이어 N")이면 번호, 아니면 첫 글자 */
const initialOf = (name: string) => name.trim().match(/^플레이어\s*(\d+)$/)?.[1] ?? (name.trim().slice(0, 1) || "?");

export function avatar(p: Player, size: "sm" | "lg" = "sm") {
  return h("span", { class: `avatar avatar-${size}`, style: `--c:${p.color}` }, initialOf(p.name));
}

/** 진행 단계 표시 */
export function stepper(steps: string[], current: number) {
  return h(
    "ol",
    { class: "stepper" },
    ...steps.map((s, i) => h("li", { class: i < current ? "done" : i === current ? "current" : "" }, s)),
  );
}

/**
 * 멀티 진행 공통 부분: 플레이어 등록, 차례 넘기기, 차례대로 플레이, 결과.
 * 기본 모드와 프리스타일이 이것을 상속한다.
 */
export abstract class MultiBase {
  protected app: App;
  protected match: Match;
  protected abstract title: string;
  protected abstract steps: string[];

  constructor(app: App, match: Match) {
    this.app = app;
    this.match = match;
  }

  protected get list() {
    return this.match.players;
  }

  abstract start(): void;
  /** 플레이어 등록 다음 단계 */
  protected abstract afterPlayers(): void;
  /** 이 플레이어가 따라 할 채보 */
  protected abstract chartFor(p: Player): Chart;
  protected abstract playLines(p: Player): (string | Node)[];
  /** "한 판 더" */
  protected abstract again(): void;
  protected abstract onExit(): void;
  /** 결과 화면에 추가할 버튼 */
  protected resultActions(): HTMLElement[] {
    return [];
  }

  protected header(step: number, onBack?: () => void, sub?: string) {
    return [panelHeader(this.title, { onBack, sub }), stepper(this.steps, step)];
  }

  // 플레이어 등록
  protected players() {
    const { app } = this;
    app.go(
      screen((root) => {
        const rows = h("div", { class: "player-list" });
        const add = button(
          "플레이어 추가",
          () => {
            if (this.list.length >= MAX_PLAYERS) return;
            const n = this.list.length;
            this.list.push({
              id: crypto.randomUUID(),
              name: `플레이어 ${n + 1}`,
              color: PLAYER_COLORS[n % PLAYER_COLORS.length],
            });
            render();
          },
          "dashed",
          "plus",
        );
        const render = () => {
          rows.replaceChildren(
            ...this.list.map((p, i) => {
              const av = avatar(p);
              return h(
                "div",
                { class: "player-row" },
                av,
                h("input", {
                  value: p.name,
                  maxLength: 12,
                  oninput: (e: Event) => {
                    p.name = (e.target as HTMLInputElement).value.trim() || `플레이어 ${i + 1}`;
                    av.textContent = initialOf(p.name);
                  },
                }),
                i === 0 ? h("span", { class: "tag" }, "방장") : null,
                this.list.length > 2
                  ? iconButton("x", "삭제", () => {
                      this.list.splice(i, 1);
                      render();
                    })
                  : null,
              );
            }),
          );
          add.hidden = this.list.length >= MAX_PLAYERS;
        };
        render();

        root.append(
          panel(
            ...this.header(0, () => this.onExit()),
            h("p", { class: "muted" }, "한 기기에서 차례대로 플레이해요. 첫 번째 플레이어가 방장입니다."),
            rows,
            add,
            h("div", { class: "row" }, button("다음", () => this.afterPlayers(), "primary", "arrow")),
          ),
        );
      }),
    );
  }

  /** 다음 사람에게 넘기는 화면 */
  protected handoff(p: Player, step: number, title: string, lines: (string | Node)[], go: () => void) {
    this.app.go(
      screen((root) =>
        root.append(
          panel(
            ...this.header(step),
            h("div", { class: "handoff" }, avatar(p, "lg"), h("h2", null, title)),
            ...lines.map((l) => (typeof l === "string" ? h("p", null, l) : l)),
            h(
              "div",
              { class: "row" },
              button("그만두기", () => this.results(true)),
              button("준비 완료", go, "primary", "play"),
            ),
          ),
        ),
      ),
    );
  }

  // 차례대로 플레이
  protected playTurn(i: number, last?: Player) {
    const { app, match } = this;
    const p = this.list[i];
    if (!p) return this.results(false);
    const prev = last?.result
      ? h(
          "div",
          { class: "prev-score" },
          avatar(last),
          h("span", null, last.name),
          h("strong", null, `${last.result.score.toLocaleString()}점`),
        )
      : null;
    this.handoff(
      p,
      this.steps.length - 2,
      `${p.name}의 플레이`,
      [
        ...(prev ? [prev] : []),
        ...this.playLines(p),
        h("p", { class: "muted" }, "다가오는 주황색 고스트에 몸을 맞추세요. 링이 줄어드는 순간이 판정 타이밍이에요."),
      ],
      () =>
        app.go(
          new PlayScene(app, {
            song: match.song!,
            chart: this.chartFor(p),
            difficulty: match.difficulty,
            playerName: p.name,
            color: p.color,
            onDone: (result) => {
              p.result = result;
              this.playTurn(i + 1, p);
            },
            onBack: () => this.playTurn(i, last),
          }),
        ),
    );
  }

  // 결과
  protected results(aborted: boolean) {
    const { app, match } = this;
    const ranked = [...this.list].filter((p) => p.result).sort((a, b) => b.result!.score - a.result!.score);
    const top = ranked[0]?.result?.score;
    const winners = ranked.filter((p) => p.result!.score === top);

    app.go(
      screen((root) =>
        root.append(
          panel(
            ...this.header(
              this.steps.length - 1,
              undefined,
              match.song ? `${match.song.title} · ${DIFFICULTY_LABEL[match.difficulty]}` : undefined,
            ),
            winners.length && !aborted
              ? h(
                  "div",
                  { class: "winner" },
                  icon("trophy", 22),
                  h("span", null, winners.length > 1 ? "공동 1위" : "1위"),
                  h("strong", null, winners.map((w) => w.name).join(", ")),
                )
              : h("p", { class: "muted" }, aborted ? "게임을 중단했어요." : "플레이한 사람이 없어요."),
            h(
              "div",
              { class: "ranking" },
              ...ranked.map((p, i) =>
                h(
                  "details",
                  { class: "rank-row" },
                  h(
                    "summary",
                    null,
                    h("span", { class: "rank-pos" }, `${i + 1}`),
                    avatar(p),
                    h("span", { class: "rank-name" }, p.name),
                    h("span", { class: "rank-grade" }, rankOf(p.result!.accuracy)),
                    h("span", { class: "rank-score" }, p.result!.score.toLocaleString()),
                  ),
                  resultTable(p.result!),
                ),
              ),
            ),
            h(
              "div",
              { class: "row" },
              button("나가기", () => this.onExit()),
              ...this.resultActions(),
              button(
                "한 판 더",
                () => {
                  for (const p of this.list) {
                    p.candidate = undefined;
                    p.chart = undefined;
                    p.assignedFrom = undefined;
                    p.result = undefined;
                  }
                  this.again();
                },
                "primary",
                "refresh",
              ),
            ),
          ),
        ),
      ),
    );
  }
}
