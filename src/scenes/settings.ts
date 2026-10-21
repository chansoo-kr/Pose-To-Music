import type { App, Scene } from "../app";
import type { ModelVariant } from "../pose/landmarker";
import { h, panel, panelHeader } from "../ui";
import { TitleScene } from "./title";

export class SettingsScene implements Scene {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  enter(root: HTMLElement) {
    const { app } = this;
    const s = app.settings;
    const status = h("p", { class: "muted" });

    const reloadModel = async () => {
      app.saveSettings();
      status.textContent = "모델 불러오는 중…";
      try {
        await app.tracker.loadModel(s.model, s.forceCpu);
        status.textContent = `모델 변경 완료 (${app.tracker.delegate})`;
      } catch (err) {
        status.textContent = `모델 변경 실패: ${String(err)}`;
      }
    };

    const model = h(
      "select",
      {
        onchange: (e: Event) => {
          s.model = (e.target as HTMLSelectElement).value as ModelVariant;
          void reloadModel();
        },
      },
      h("option", { value: "full", selected: s.model === "full" }, "Full · 정확"),
      h("option", { value: "lite", selected: s.model === "lite" }, "Lite · 가벼움"),
    );

    const latencyLabel = h("span", null, `${s.latencyMs} ms`);
    const latency = h("input", {
      type: "range",
      min: 0,
      max: 300,
      step: 10,
      value: s.latencyMs,
      oninput: (e: Event) => {
        s.latencyMs = Number((e.target as HTMLInputElement).value);
        latencyLabel.textContent = `${s.latencyMs} ms`;
        app.saveSettings();
      },
    });

    const maxSong = h(
      "select",
      {
        onchange: (e: Event) => {
          s.maxSongSec = Number((e.target as HTMLSelectElement).value);
          app.saveSettings();
        },
      },
      ...[30, 45, 60, 90, 120].map((v) => h("option", { value: v, selected: s.maxSongSec === v }, `${v}초`)),
    );

    const forceCpu = h("input", {
      type: "checkbox",
      checked: s.forceCpu,
      onchange: (e: Event) => {
        s.forceCpu = (e.target as HTMLInputElement).checked;
        void reloadModel();
      },
    });

    const debug = h("input", {
      type: "checkbox",
      checked: s.debug,
      onchange: (e: Event) => {
        s.debug = (e.target as HTMLInputElement).checked;
        app.saveSettings();
      },
    });

    const toggle = (input: HTMLInputElement, title: string, desc: string) =>
      h(
        "label",
        { class: "setting-row" },
        h("div", null, h("strong", null, title), h("p", { class: "hint" }, desc)),
        input,
      );
    forceCpu.classList.add("switch");
    debug.classList.add("switch");

    root.append(
      panel(
        panelHeader("설정", { kicker: "Settings", onBack: () => app.go(new TitleScene(app)) }),
        h(
          "label",
          { class: "setting-row" },
          h("div", null, h("strong", null, "포즈 인식 모델"), h("p", { class: "hint" }, "Lite는 저사양 기기용이에요.")),
          model,
        ),
        h(
          "div",
          { class: "setting-row column" },
          h(
            "div",
            { class: "setting-title" },
            h("strong", null, "카메라 지연 보정"),
            h("span", { class: "value-badge" }, latencyLabel),
          ),
          latency,
          h("p", { class: "hint" }, "판정이 계속 늦게 나온다고 느껴지면 값을 올리고, 너무 빠르면 낮춰 보세요."),
        ),
        h(
          "label",
          { class: "setting-row" },
          h("div", null, h("strong", null, "업로드 곡 최대 길이"), h("p", { class: "hint" }, "멀티 플레이에서 올린 음악에 적용돼요.")),
          maxSong,
        ),
        toggle(forceCpu, "CPU 모드 강제", "GPU 가속이 불안정할 때 켜 보세요."),
        toggle(debug, "디버그 정보", "FPS와 추론 시간을 화면 구석에 표시해요."),
        status,
      ),
    );
  }
}
