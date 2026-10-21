import type { App, Scene } from "../app";
import { h, panel, panelHeader } from "../ui";
import { ClassicSingleScene } from "./classic";
import { FreestyleSingle } from "./freestyle";
import { TitleScene } from "./title";

/** 싱글: 기본 모드 / 프리스타일 고르기 */
export class ModeScene implements Scene {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  enter(root: HTMLElement) {
    const { app } = this;
    const item = (title: string, desc: string, onclick: () => void) =>
      h(
        "button",
        { class: "game-btn tile", onclick, onmouseenter: () => app.audio.sfx("tick") },
        h("span", null, title),
        h("small", null, desc),
      );

    const el = panel(
      panelHeader("싱글", { onBack: () => app.go(new TitleScene(app)) }),
      h(
        "div",
        { class: "tile-row" },
        item("기본 모드", "저장된 채보를 골라 따라 해요.", () => app.go(new ClassicSingleScene(app))),
        item("프리스타일", "곡을 골라 내 포즈를 녹화하고, 바로 그 채보를 따라 해요.", () =>
          new FreestyleSingle(app).start(),
        ),
      ),
    );
    el.classList.add("game-panel");
    root.append(el);
  }
}
