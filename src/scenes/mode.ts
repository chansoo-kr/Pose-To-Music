import type { App, Scene } from "../app";
import { h, panel, panelHeader } from "../ui";
import { ClassicSingleScene } from "./classic";
import { FreestyleSingle } from "./freestyle";
import { ClassicMulti } from "./multi/classic";
import { FreestyleMulti } from "./multi/freestyle";
import { TitleScene } from "./title";

export type GameMode = "classic" | "freestyle";

const INFO: Record<GameMode, { title: string; single: string; multi: string }> = {
  classic: {
    title: "기본 모드",
    single: "저장된 채보를 골라 따라 해요.",
    multi: "방장이 채보를 정하고, 모두 같은 채보를 차례로 플레이해 순위를 겨뤄요.",
  },
  freestyle: {
    title: "프리스타일",
    single: "곡을 골라 내 포즈를 녹화하고, 바로 그 채보를 따라 해요.",
    multi: "각자 포즈를 녹화한 뒤 채보를 섞어 나눠 받고, 남의 채보를 따라 해요.",
  },
};

/** 모드 선택 후 싱글/멀티 고르기 */
export class ModeScene implements Scene {
  private app: App;
  private mode: GameMode;

  constructor(app: App, mode: GameMode) {
    this.app = app;
    this.mode = mode;
  }

  enter(root: HTMLElement) {
    const { app, mode } = this;
    const info = INFO[mode];
    const item = (title: string, desc: string, onclick: () => void) =>
      h("button", { class: "menu-item", onclick }, h("span", null, title), h("small", null, desc));

    root.append(
      panel(
        panelHeader(info.title, { onBack: () => app.go(new TitleScene(app)) }),
        h(
          "nav",
          { class: "menu" },
          item("싱글", info.single, () =>
            mode === "classic" ? app.go(new ClassicSingleScene(app)) : new FreestyleSingle(app).start(),
          ),
          item("멀티", `${info.multi} (한 기기, 2~6명)`, () =>
            mode === "classic" ? new ClassicMulti(app).start() : new FreestyleMulti(app).start(),
          ),
        ),
      ),
    );
  }
}
