import type { App, Scene } from "../app";
import { TapTempo, detectTempo } from "../audio/beat";
import { BUILTIN_SONGS, findSong, registerUpload, type Song } from "../audio/songs";
import { saveChart } from "../game/chart";
import { PLAYER_COLORS, assignCharts, newMatch, playerById, type Match, type Player } from "../game/match";
import { DIFFICULTY_LABEL } from "../pose/joints";
import { button, h, icon, iconButton, label, panel, panelHeader } from "../ui";
import { PlayScene } from "./play";
import { RecordScene } from "./record";
import { difficultyPicker, rankOf, resultTable, songCover } from "./single";
import { TitleScene } from "./title";

const MAX_PLAYERS = 6;
const UPLOAD = "__upload__";
const STEPS = ["플레이어", "곡 후보", "돌림판", "녹화", "교환", "플레이", "결과"];

/** 간단한 화면: enter에서 그리기만 하는 Scene */
function screen(render: (root: HTMLElement) => void, extra: Partial<Scene> = {}): Scene {
  return { enter: render, ...extra };
}

/** 멀티 플레이 진행 단계 표시 */
function stepper(current: number) {
  return h(
    "ol",
    { class: "stepper" },
    ...STEPS.map((s, i) =>
      h("li", { class: i < current ? "done" : i === current ? "current" : "" }, h("span", null, s)),
    ),
  );
}

/** 아바타 글자: 기본 이름("플레이어 N")이면 번호, 아니면 첫 글자 */
const initialOf = (name: string) => name.trim().match(/^플레이어\s*(\d+)$/)?.[1] ?? (name.trim().slice(0, 1) || "?");

function avatar(p: Player, size: "sm" | "lg" = "sm") {
  return h("span", { class: `avatar avatar-${size}`, style: `--c:${p.color}` }, initialOf(p.name));
}

/**
 * 로컬(한 기기) 멀티 플레이 진행.
 * 플레이어 등록 → 곡 후보 → 돌림판 → 안무 녹화(차례대로) → 안무 교환 → 플레이(차례대로) → 결과
 */
export class MultiFlow {
  private app: App;
  private match: Match = newMatch();

  constructor(app: App) {
    this.app = app;
  }

  start() {
    this.players();
  }

  private get list() {
    return this.match.players;
  }

  // 1. 플레이어 등록
  private players() {
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
            panelHeader("플레이어 등록", { kicker: "Multiplayer", onBack: () => app.go(new TitleScene(app)) }),
            stepper(0),
            h("p", { class: "muted" }, "한 기기에서 차례대로 플레이해요. (2~6명)"),
            rows,
            add,
            h("div", { class: "row" }, button("다음", () => this.candidates(), "primary", "arrow")),
          ),
        );
      }),
    );
  }

  // 2. 각자 곡 후보 선택
  private candidates() {
    const { app } = this;
    app.go(
      screen(
        (root) => {
          const next = h(
            "button",
            { class: "btn primary", onclick: () => this.roulette() },
            icon("shuffle", 18),
            h("span", null, "돌림판으로"),
          );
          const refresh = () => (next.disabled = !this.list.every((p) => p.candidate));
          root.append(
            panel(
              panelHeader("곡 후보 고르기", { kicker: "Multiplayer", onBack: () => this.players() }),
              stepper(1),
              h("p", { class: "muted" }, "각자 한 곡씩 고르면 돌림판으로 이번 판의 곡을 정해요."),
              h("div", { class: "player-list" }, ...this.list.map((p) => this.candidateRow(p, refresh))),
              h("div", { class: "row" }, next),
            ),
          );
          refresh();
        },
        { exit: () => app.audio.stop() },
      ),
    );
  }

  private candidateRow(p: Player, refresh: () => void) {
    const { app } = this;
    const detail = h("div", { class: "upload-detail" });

    const showUpload = (song: Song) => {
      const bpm = h("input", {
        type: "number",
        min: 40,
        max: 240,
        step: 0.1,
        value: song.bpm,
        oninput: (e: Event) => (song.bpm = Number((e.target as HTMLInputElement).value) || song.bpm),
      });
      const offset = h("input", {
        type: "number",
        step: 10,
        value: song.offsetMs,
        oninput: (e: Event) => (song.offsetMs = Number((e.target as HTMLInputElement).value) || 0),
      });
      const tapper = new TapTempo();
      let previewing = false;
      const previewLabel = h("span", null, "미리듣기");
      const setPreviewing = (v: boolean) => {
        previewing = v;
        previewLabel.textContent = v ? "정지" : "미리듣기";
      };
      const preview = h(
        "button",
        {
          class: "btn ghost small",
          onclick: async () => {
            if (previewing) {
              app.audio.stop();
              setPreviewing(false);
            } else {
              app.audio.play(await song.load(), { onEnded: () => setPreviewing(false) });
              setPreviewing(true);
            }
          },
        },
        icon("play", 16),
        previewLabel,
      );
      detail.replaceChildren(
        h("label", { class: "mini-field" }, h("span", null, "BPM"), bpm),
        h("label", { class: "mini-field" }, h("span", null, "첫 박 ms"), offset),
        preview,
        button(
          "탭 템포",
          () => {
            const v = tapper.tap();
            if (v) {
              song.bpm = v;
              bpm.value = String(v);
            }
          },
          "ghost small",
          "tap",
        ),
        h("p", { class: "hint" }, "자동 추정값이에요. 미리듣기하며 박자에 맞춰 탭하면 보정됩니다."),
      );
    };

    const file = h("input", {
      type: "file",
      accept: "audio/*",
      hidden: true,
      onchange: async (e: Event) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (!f) return;
        detail.replaceChildren(h("span", { class: "loading-inline" }, h("span", { class: "spinner" }), "분석 중…"));
        try {
          const buffer = await app.audio.decode(await f.arrayBuffer());
          const song = registerUpload(f.name, buffer, detectTempo(buffer));
          p.candidate = song;
          const opt = h("option", { value: song.id }, `📁 ${song.title}`);
          select.insertBefore(opt, select.lastChild);
          select.value = song.id;
          showUpload(song);
        } catch (err) {
          detail.replaceChildren(h("span", { class: "warn" }, `음악 파일을 읽을 수 없어요: ${String(err)}`));
        }
        refresh();
      },
    });

    const select: HTMLSelectElement = h(
      "select",
      {
        onchange: () => {
          if (select.value === UPLOAD) {
            select.value = p.candidate?.id ?? "";
            file.click();
            return;
          }
          p.candidate = findSong(select.value);
          if (p.candidate?.source === "upload") showUpload(p.candidate);
          else detail.replaceChildren();
          refresh();
        },
      },
      h("option", { value: "", disabled: true, selected: !p.candidate }, "곡을 고르세요"),
      ...BUILTIN_SONGS.map((s) =>
        h("option", { value: s.id, selected: p.candidate?.id === s.id }, `${s.title} (${s.bpm} BPM)`),
      ),
      p.candidate?.source === "upload"
        ? h("option", { value: p.candidate.id, selected: true }, `📁 ${p.candidate.title}`)
        : null,
      h("option", { value: UPLOAD }, "내 음악 파일 올리기…"),
    );
    if (p.candidate?.source === "upload") showUpload(p.candidate);

    return h(
      "div",
      { class: "candidate-row" },
      h("div", { class: "player-name" }, avatar(p), h("span", null, p.name)),
      select,
      file,
      detail,
    );
  }

  // 3. 돌림판 → 곡 확정 + 규칙 설정
  private roulette() {
    const { app, match } = this;
    app.go(
      screen((root) => {
        const entries = this.list.map((p) => ({ player: p, song: p.candidate! }));
        const wheel = new Wheel(entries.map((e) => ({ label: e.song.title, sub: e.player.name, color: e.player.color })));
        const after = h("div", { class: "roulette-after" });

        const spin = button(
          "돌리기",
          async () => {
            spin.disabled = true;
            const idx = await wheel.spin(() => app.audio.sfx("tick"));
            app.audio.sfx("perfect");
            match.song = entries[idx].song;
            spin.hidden = true;
            showSetup();
          },
          "primary big",
          "shuffle",
        );

        const showSetup = () => {
          const intervalSeg = h("div", { class: "segmented" });
          const renderInterval = () =>
            intervalSeg.replaceChildren(
              ...[1, 2, 4].map((n) =>
                h(
                  "button",
                  {
                    class: `seg${match.interval === n ? " active" : ""}`,
                    onclick: () => {
                      match.interval = n;
                      renderInterval();
                    },
                  },
                  h("strong", null, `${n}박`),
                  h("small", null, n === 1 ? "빠름" : n === 2 ? "보통" : "여유"),
                ),
              ),
            );
          renderInterval();
          const song = match.song!;
          after.replaceChildren(
            h(
              "div",
              { class: "picked" },
              songCover(song.id),
              h(
                "div",
                { class: "song-meta" },
                h("small", null, "이번 판의 곡"),
                h("strong", null, song.title),
                h("span", null, `${song.bpm} BPM`),
              ),
            ),
            label("난이도"),
            difficultyPicker(match.difficulty, (d) => (match.difficulty = d)),
            label("포즈 간격"),
            intervalSeg,
            h(
              "div",
              { class: "row" },
              button("다시 돌리기", () => this.roulette(), "ghost", "refresh"),
              button("안무 녹화 시작", () => this.recordTurn(0), "primary", "arrow"),
            ),
          );
        };

        root.append(
          panel(
            panelHeader("돌림판", { kicker: "Multiplayer", onBack: () => this.candidates() }),
            stepper(2),
            wheel.el,
            h("div", { class: "row center" }, spin),
            after,
          ),
        );
      }),
    );
  }

  /** 다음 사람에게 넘기는 화면 */
  private handoff(p: Player, step: number, title: string, lines: (string | Node)[], go: () => void) {
    this.app.go(
      screen(
        (root) =>
          root.append(
            panel(
              stepper(step),
              h(
                "div",
                { class: "handoff" },
                avatar(p, "lg"),
                h("div", null, h("div", { class: "kicker" }, "Next up"), h("h2", null, title)),
              ),
              ...lines.map((l) => (typeof l === "string" ? h("p", null, l) : l)),
              h(
                "div",
                { class: "row" },
                button("그만두기", () => this.results(true), "ghost"),
                button("준비 완료", go, "primary", "play"),
              ),
            ),
          ),
      ),
    );
  }

  // 4. 안무 녹화 (차례대로)
  private recordTurn(i: number) {
    const { app, match } = this;
    const p = this.list[i];
    if (!p) return this.swap();
    this.handoff(
      p,
      3,
      `${p.name}의 안무 녹화`,
      [
        `"${match.song!.title}"에 맞춰 상대방이 따라 할 포즈를 ${match.interval}박마다 취하세요.`,
        h(
          "p",
          { class: "muted" },
          "셔터 소리가 날 때의 포즈가 저장됩니다. 판정 관절이 잘 보이도록 크고 분명하게!",
        ),
      ],
      () =>
        app.go(
          new RecordScene(app, {
            song: match.song!,
            interval: match.interval,
            author: p.name,
            color: p.color,
            onDone: (chart) => {
              p.chart = chart;
              this.recordTurn(i + 1);
            },
            onBack: () => this.recordTurn(i),
          }),
        ),
    );
  }

  // 5. 안무 랜덤 교환
  private swap() {
    const { app } = this;
    const map = assignCharts(this.list);
    for (const p of this.list) p.assignedFrom = map.get(p.id);
    app.go(
      screen((root) => {
        const cards = this.list.map((p, i) => {
          const from = playerById(this.match, p.assignedFrom)!;
          return h(
            "div",
            { class: "swap-card", style: `animation-delay:${i * 0.2}s` },
            h("div", { class: "swap-who" }, avatar(p), h("strong", null, p.name)),
            h("span", { class: "swap-arrow" }, icon("back", 18)),
            h("div", { class: "swap-who" }, avatar(from), h("span", null, `${from.name}의 안무`)),
          );
        });
        root.append(
          panel(
            panelHeader("안무 교환", { kicker: "Multiplayer" }),
            stepper(4),
            h("p", { class: "muted" }, "랜덤으로 다른 사람의 안무를 받았어요."),
            h("div", { class: "swap-list" }, ...cards),
            h("div", { class: "row" }, button("플레이 시작", () => this.playTurn(0), "primary", "play")),
          ),
        );
      }),
    );
  }

  // 6. 플레이 (차례대로)
  private playTurn(i: number, last?: Player) {
    const { app, match } = this;
    const p = this.list[i];
    if (!p) return this.results(false);
    const from = playerById(match, p.assignedFrom)!;
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
      5,
      `${p.name}의 플레이`,
      [
        ...(prev ? [prev] : []),
        `${from.name}의 안무를 따라 하세요! · ${DIFFICULTY_LABEL[match.difficulty]}`,
        h(
          "p",
          { class: "muted" },
          "다가오는 하늘색 고스트에 몸을 맞추고, 링이 줄어드는 순간이 판정 타이밍이에요.",
        ),
      ],
      () =>
        app.go(
          new PlayScene(app, {
            song: match.song!,
            chart: from.chart!,
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

  // 7. 결과
  private results(aborted: boolean) {
    const { app, match } = this;
    const ranked = [...this.list].filter((p) => p.result).sort((a, b) => b.result!.score - a.result!.score);
    const top = ranked[0]?.result?.score;
    const winners = ranked.filter((p) => p.result!.score === top);

    app.go(
      screen((root) => {
        const saveBtn = button(
          "안무 저장",
          () => {
            let n = 0;
            for (const p of this.list) {
              if (p.chart && match.song?.source === "builtin") {
                saveChart(p.chart);
                n++;
              }
            }
            saveBtn.disabled = true;
            saveBtn.lastElementChild!.textContent = n ? `${n}개 저장됨` : "저장할 안무 없음";
          },
          "ghost",
          "save",
        );
        if (match.song?.source !== "builtin") {
          saveBtn.disabled = true;
          saveBtn.title = "업로드한 곡의 안무는 저장할 수 없어요";
        }

        root.append(
          panel(
            panelHeader(aborted ? "게임 중단" : "최종 결과", { kicker: match.song?.title ?? "Multiplayer" }),
            stepper(6),
            winners.length && !aborted
              ? h(
                  "div",
                  { class: "winner" },
                  h("span", { class: "winner-icon" }, icon("trophy", 28)),
                  h(
                    "div",
                    null,
                    h("div", { class: "kicker" }, winners.length > 1 ? "Draw" : "Winner"),
                    h("strong", null, winners.map((w) => w.name).join(", ")),
                  ),
                )
              : null,
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
              button("타이틀로", () => app.go(new TitleScene(app)), "ghost"),
              saveBtn,
              button(
                "한 판 더",
                () => {
                  for (const p of this.list) {
                    p.candidate = undefined;
                    p.chart = undefined;
                    p.assignedFrom = undefined;
                    p.result = undefined;
                  }
                  match.song = undefined;
                  this.candidates();
                },
                "primary",
                "refresh",
              ),
            ),
          ),
        );
      }),
    );
  }
}

interface WheelEntry {
  label: string;
  sub: string;
  color: string;
}

/** 캔버스 돌림판 */
class Wheel {
  readonly el: HTMLCanvasElement;
  private entries: WheelEntry[];
  private rotation = 0;

  constructor(entries: WheelEntry[]) {
    this.entries = entries;
    this.el = h("canvas", { class: "wheel", width: 640, height: 640 });
    this.draw();
    // 웹폰트가 늦게 로드되면 다시 그린다
    void document.fonts?.ready.then(() => this.draw());
  }

  private get seg() {
    return (Math.PI * 2) / this.entries.length;
  }

  private draw() {
    const ctx = this.el.getContext("2d")!;
    const S = this.el.width;
    const c = S / 2;
    const R = c - 28;
    ctx.clearRect(0, 0, S, S);

    // 바깥 링
    ctx.beginPath();
    ctx.arc(c, c, R + 14, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();

    this.entries.forEach((e, i) => {
      const a0 = this.rotation + i * this.seg;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, R, a0, a0 + this.seg);
      ctx.closePath();
      const g = ctx.createRadialGradient(c, c, R * 0.2, c, c, R);
      g.addColorStop(0, "#15151d");
      g.addColorStop(1, e.color);
      ctx.fillStyle = g;
      ctx.globalAlpha = i % 2 ? 0.82 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#0b0b10";
      ctx.lineWidth = 6;
      ctx.stroke();

      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(a0 + this.seg / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = "#0b0b10";
      ctx.font = "800 30px 'Pretendard Variable', system-ui, sans-serif";
      ctx.fillText(e.label.length > 14 ? `${e.label.slice(0, 13)}…` : e.label, R - 28, 4);
      ctx.font = "600 20px 'Pretendard Variable', system-ui, sans-serif";
      ctx.globalAlpha = 0.7;
      ctx.fillText(e.sub, R - 28, 30);
      ctx.restore();
    });

    // 가운데 허브
    ctx.beginPath();
    ctx.arc(c, c, 44, 0, Math.PI * 2);
    ctx.fillStyle = "#0b0b10";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c, c, 12, 0, Math.PI * 2);
    ctx.fillStyle = "#d4ff3a";
    ctx.fill();

    // 위쪽 포인터
    ctx.save();
    ctx.shadowColor = "rgba(212,255,58,0.6)";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(c - 20, 4);
    ctx.lineTo(c + 20, 4);
    ctx.lineTo(c, 50);
    ctx.closePath();
    ctx.fillStyle = "#d4ff3a";
    ctx.fill();
    ctx.restore();
  }

  /** @returns 당첨된 항목 인덱스 */
  spin(onTick: () => void): Promise<number> {
    const start = this.rotation;
    const total = Math.PI * 2 * (5 + Math.random() * 2) + Math.random() * Math.PI * 2;
    const dur = 4200;
    const t0 = performance.now();
    let lastSeg = this.pointerIndex();

    return new Promise((resolve) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / dur);
        const ease = 1 - (1 - t) ** 4;
        this.rotation = start + total * ease;
        this.draw();
        const seg = this.pointerIndex();
        if (seg !== lastSeg) {
          lastSeg = seg;
          onTick();
        }
        if (t < 1) requestAnimationFrame(step);
        else resolve(seg);
      };
      requestAnimationFrame(step);
    });
  }

  /** 위쪽 포인터가 가리키는 항목 */
  private pointerIndex() {
    const TAU = Math.PI * 2;
    const theta = (((-Math.PI / 2 - this.rotation) % TAU) + TAU) % TAU;
    return Math.floor(theta / this.seg) % this.entries.length;
  }
}
