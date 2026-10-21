import type { App, Scene } from "../app";
import { h } from "../ui";
import { initTracker } from "./common";
import { EditorListScene } from "./editor/list";
import { ModeScene } from "./mode";
import { SettingsScene } from "./settings";

export class TitleScene implements Scene {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  enter(root: HTMLElement) {
    const { app } = this;
    const status = h("div", { class: "status" });
    const item = (title: string, desc: string, onclick: () => void) =>
      h("button", { class: "menu-item", onclick }, h("span", null, title), h("small", null, desc));

    // 게임 모드는 카메라가 준비돼야 들어갈 수 있다
    const games = [
      item("기본 모드", "만들어진 채보를 따라 하기", () => app.go(new ModeScene(app, "classic"))),
      item("프리스타일", "곡을 정하고 그 자리에서 채보 만들기", () => app.go(new ModeScene(app, "freestyle"))),
    ];
    const retry = h("button", { class: "link", hidden: true, onclick: () => this.prepare(status, games, retry) }, "다시 시도");

    root.append(
      h(
        "div",
        { class: "title-screen" },
        h("h1", { class: "logo" }, "포트뮤", h("small", null, "Pose To Music")),
        h(
          "nav",
          { class: "menu" },
          ...games,
          item("채보 에디터", "곡 추가, 박자 찍기, 채보 만들기", () => app.go(new EditorListScene(app))),
          item("설정", "카메라 지연, 인식 모델", () => app.go(new SettingsScene(app))),
        ),
        h("div", { class: "status-row" }, status, retry),
      ),
    );
    this.prepare(status, games, retry);
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
