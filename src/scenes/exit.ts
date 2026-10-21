import type { App, Scene } from "../app";
import { button, h, panel } from "../ui";

/** 종료: 카메라와 모델을 정리하고 탭 닫기를 시도한다 (브라우저가 막으면 안내) */
export class ExitScene implements Scene {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  enter(root: HTMLElement) {
    this.app.tracker.stop();
    window.close();
    const el = panel(
      h("div", { class: "exit-screen" }, h("h2", null, "종료됨"), h("p", { class: "muted" }, "카메라를 껐어요. 이제 탭을 닫아도 돼요.")),
      h("div", { class: "row center" }, button("다시 시작", () => location.reload(), "primary", "refresh")),
    );
    el.classList.add("game-panel");
    root.append(el);
  }
}
