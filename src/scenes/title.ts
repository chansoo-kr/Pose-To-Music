import type { App, Scene } from "../app";
import { button, h, icon, iconButton, type IconName } from "../ui";
import { MultiFlow } from "./multi";
import { SettingsScene } from "./settings";
import { SingleSelectScene } from "./single";

let initPromise: Promise<void> | null = null;

/** 카메라 + 포즈 모델 준비 (한 번만) */
export function initTracker(app: App): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await app.tracker.startCamera();
      await app.tracker.loadModel(app.settings.model, app.settings.forceCpu);
      app.tracker.start();
      app.stage.resize();
    })();
    initPromise.catch(() => (initPromise = null));
  }
  return initPromise;
}

export class TitleScene implements Scene {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  enter(root: HTMLElement) {
    const { app } = this;
    const status = h("div", { class: "status-pill" }, "카메라와 포즈 인식 모델을 준비하는 중…");
    const modeCard = (iconName: IconName, title: string, desc: string, tag: string, onclick: () => void) =>
      h(
        "button",
        { class: "mode-card", onclick },
        h("span", { class: "mode-icon" }, icon(iconName, 26)),
        h("span", { class: "mode-tag" }, tag),
        h("strong", null, title),
        h("span", { class: "mode-desc" }, desc),
        h("span", { class: "mode-arrow" }, icon("arrow", 20)),
      );
    const single = modeCard("user", "싱글 플레이", "기본 안무를 음악에 맞춰 따라 춰요", "SOLO", () =>
      app.go(new SingleSelectScene(app)),
    );
    const multi = modeCard("users", "멀티 플레이", "서로 안무를 만들고, 바꿔서 대결해요", "2–6P", () =>
      new MultiFlow(app).start(),
    );
    const retry = button("다시 시도", () => this.prepare(status, [single, multi], retry), "ghost small", "refresh");
    retry.hidden = true;

    root.append(
      iconButton("settings", "설정", () => app.go(new SettingsScene(app)), "corner"),
      h(
        "div",
        { class: "title-screen" },
        h("div", { class: "eyebrow" }, "포트뮤 · Pose Rhythm Game"),
        h("h1", { class: "logo" }, "POSE", h("br"), "TO MUSIC"),
        h("p", { class: "tagline" }, "카메라 앞에서 박자에 맞춰 포즈를 취하세요."),
        h("div", { class: "mode-grid" }, single, multi),
        h("div", { class: "status-row" }, status, retry),
      ),
    );
    this.prepare(status, [single, multi], retry);
  }

  private prepare(status: HTMLElement, buttons: HTMLButtonElement[], retry: HTMLButtonElement) {
    const { app } = this;
    buttons.forEach((b) => (b.disabled = true));
    retry.hidden = true;
    status.classList.remove("error", "ready");
    status.textContent = "카메라와 포즈 인식 모델을 준비하는 중…";
    initTracker(app)
      .then(() => {
        buttons.forEach((b) => (b.disabled = false));
        status.classList.add("ready");
        status.textContent = `준비 완료 · ${app.tracker.delegate === "GPU" ? "GPU 가속" : "CPU"} · ${app.tracker.model}`;
      })
      .catch((err: unknown) => {
        console.error(err);
        status.classList.add("error");
        const denied = err instanceof DOMException && err.name === "NotAllowedError";
        status.textContent = denied
          ? "카메라 권한이 필요해요. 브라우저에서 카메라를 허용한 뒤 다시 시도해 주세요."
          : `준비 실패: ${err instanceof Error ? err.message : String(err)}`;
        retry.hidden = false;
      });
  }
}
