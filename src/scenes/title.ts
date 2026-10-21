import type { App, Scene } from "../app";
import { h, icon } from "../ui";
import { initTracker } from "./common";
import { EditorListScene } from "./editor/list";
import { ExitScene } from "./exit";
import { ModeScene } from "./mode";
import { OnlineEntryScene } from "./online/entry";
import { SettingsScene } from "./settings";

/** 플레이 → 싱글/멀티가 펼쳐져 있었는지 (돌아왔을 때 유지) */
let playOpen = false;

/** 메인: 계단식 로고 + 플레이(싱글/멀티) · 설정 · 종료 */
export class TitleScene implements Scene {
  private app: App;
  private onKey: ((e: KeyboardEvent) => void) | null = null;

  constructor(app: App) {
    this.app = app;
  }

  exit() {
    if (this.onKey) window.removeEventListener("keydown", this.onKey);
  }

  enter(root: HTMLElement) {
    const { app } = this;
    const status = h("div", { class: "status" });

    const btn = (label: string, onclick: () => void, cls = "") =>
      h(
        "button",
        {
          class: `game-btn ${cls}`,
          onclick: () => {
            app.audio.sfx("select");
            onclick();
          },
          onmouseenter: (e: Event) => !(e.currentTarget as HTMLButtonElement).disabled && app.audio.sfx("tick"),
        },
        h("span", null, label),
      );

    const sub = h("div", { class: "play-sub" });
    const play = btn("플레이", () => setOpen(!playOpen), "main");
    const single = btn("싱글", () => app.go(new ModeScene(app)), "sub");
    const multi = btn("멀티", () => app.go(new OnlineEntryScene(app)), "sub");
    sub.innerHTML =
      '<svg class="play-arrows" viewBox="0 0 60 100" aria-hidden="true">' +
      '<path d="M2 30 L50 18 M42 12 L52 18 L44 26"/><path d="M2 40 L50 78 M40 76 L52 80 L50 68"/></svg>';
    sub.append(h("div", { class: "play-sub-btns" }, single, multi));

    const setOpen = (open: boolean) => {
      playOpen = open;
      sub.classList.toggle("open", open);
      play.classList.toggle("active", open);
      play.setAttribute("aria-expanded", String(open));
      single.tabIndex = multi.tabIndex = open ? 0 : -1;
    };

    // 게임은 카메라가 준비돼야 들어갈 수 있다
    const games = [play, single, multi];
    const retry = h("button", { class: "link", hidden: true, onclick: () => this.prepare(status, games, retry) }, "다시 시도");

    const menu = h(
      "nav",
      { class: "main-menu" },
      h("div", { class: "menu-play" }, play, sub),
      btn("설정", () => app.go(new SettingsScene(app)), "main"),
      btn("종료", () => app.go(new ExitScene(app)), "main exit"),
    );

    root.append(
      h(
        "div",
        { class: "title-screen" },
        h(
          "h1",
          { class: "logo-stair", "aria-label": "Pose to Music" },
          h("span", { class: "l1" }, "Pose"),
          h("span", { class: "l2" }, "to"),
          h("span", { class: "l3" }, "Music"),
        ),
        menu,
        h(
          "div",
          { class: "title-foot" },
          h("div", { class: "status-row" }, status, retry),
          h(
            "button",
            { class: "link editor-link", onclick: () => app.go(new EditorListScene(app)) },
            icon("edit", 14),
            "채보 에디터",
          ),
        ),
      ),
    );
    setOpen(playOpen);
    this.prepare(status, games, retry);

    // ↑/↓ 이동, Esc 접기
    this.onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && playOpen) {
        setOpen(false);
        play.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = [...menu.querySelectorAll<HTMLButtonElement>("button")].filter(
        (b) => !b.disabled && b.tabIndex !== -1,
      );
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[i < 0 ? 0 : next]?.focus();
      e.preventDefault();
    };
    window.addEventListener("keydown", this.onKey);
  }

  private prepare(status: HTMLElement, buttons: HTMLButtonElement[], retry: HTMLButtonElement) {
    const { app } = this;
    buttons.forEach((b) => (b.disabled = true));
    retry.hidden = true;
    status.className = "status";
    status.textContent = "카메라와 포즈 인식 모델을 준비하는 중…";
    initTracker(app)
      .then(() => {
        buttons.forEach((b) => (b.disabled = false));
        status.classList.add("ready");
        status.textContent = `준비됨 · ${app.tracker.delegate === "GPU" ? "GPU" : "CPU"} · ${app.tracker.model}`;
      })
      .catch((err: unknown) => {
        console.error(err);
        status.classList.add("error");
        const denied = err instanceof DOMException && err.name === "NotAllowedError";
        status.textContent = denied
          ? "카메라 권한이 필요해요. 브라우저에서 허용한 뒤 다시 시도해 주세요."
          : `준비 실패: ${err instanceof Error ? err.message : String(err)}`;
        retry.hidden = false;
      });
  }
}
