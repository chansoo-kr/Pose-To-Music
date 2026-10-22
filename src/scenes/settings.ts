import type { App, Scene } from "../app";
import { LENIENCIES, LENIENCY_LABEL } from "../game/scoring";
import { RELAY_URLS } from "../net/config";
import type { ModelVariant } from "../pose/landmarker";
import { h, panel, panelHeader, segmented } from "../ui";
import { NAME_MAX } from "../net/protocol";
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

    const tapLabel = h("span", null, `${s.tapOffsetMs} ms`);
    const tap = h("input", {
      type: "range",
      min: 0,
      max: 200,
      step: 5,
      value: s.tapOffsetMs,
      oninput: (e: Event) => {
        s.tapOffsetMs = Number((e.target as HTMLInputElement).value);
        tapLabel.textContent = `${s.tapOffsetMs} ms`;
        app.saveSettings();
      },
    });

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

    const showPeers = h("input", {
      type: "checkbox",
      checked: s.showPeers,
      onchange: (e: Event) => {
        s.showPeers = (e.target as HTMLInputElement).checked;
        app.saveSettings();
      },
    });

    /** 텍스트 설정 (바뀔 때마다 저장) */
    const text = (key: "nickname" | "turnUrl" | "turnUser" | "turnPass", props: Record<string, unknown> = {}) =>
      h("input", {
        type: "text",
        value: s[key],
        ...props,
        oninput: (e: Event) => {
          s[key] = (e.target as HTMLInputElement).value;
          app.saveSettings();
        },
      });

    const leniency = segmented(
      LENIENCIES.map((v) => ({ value: v, label: LENIENCY_LABEL[v] })),
      s.leniency,
      (v) => {
        s.leniency = v;
        app.saveSettings();
      },
    );

    const relays = h("textarea", {
      class: "relay-input",
      rows: 3,
      spellcheck: false,
      value: s.relays,
      placeholder: RELAY_URLS.join("\n"),
      oninput: (e: Event) => {
        s.relays = (e.target as HTMLTextAreaElement).value;
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
    showPeers.classList.add("switch");

    const el = panel(
        panelHeader("설정", { onBack: () => app.go(new TitleScene(app)) }),
        h("div", { class: "section-label" }, "게임"),
        h(
          "div",
          { class: "setting-row" },
          h("div", null, h("strong", null, "판정 여유"), h("p", { class: "hint" }, "포즈를 얼마나 정확히 맞춰야 하는지예요. 온라인에서는 방장이 정한 값을 따라요.")),
          leniency,
        ),
        h("div", { class: "section-label" }, "카메라 · 인식"),
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
          "div",
          { class: "setting-row column" },
          h(
            "div",
            { class: "setting-title" },
            h("strong", null, "탭 녹음 보정"),
            h("span", { class: "value-badge" }, tapLabel),
          ),
          tap,
          h("p", { class: "hint" }, "채보 에디터에서 키를 눌러 찍은 박자가 늦게 찍히면 값을 올려 보세요."),
        ),
        toggle(forceCpu, "CPU 모드 강제", "GPU 가속이 불안정할 때 켜 보세요."),
        toggle(debug, "디버그 정보", "FPS와 추론 시간을 화면 구석에 표시하고, 결과 화면에서 판정 기록을 내보낼 수 있어요."),
        h("div", { class: "section-label" }, "멀티"),
        h(
          "label",
          { class: "setting-row" },
          h("div", null, h("strong", null, "닉네임"), h("p", { class: "hint" }, "방에서 다른 사람에게 보이는 이름이에요.")),
          text("nickname", { maxLength: NAME_MAX, placeholder: "닉네임" }),
        ),
        toggle(
          showPeers,
          "다른 사람 포즈 보기",
          "플레이 중 순위 보드에 다른 사람의 포즈를 작게 보여 줘요. 화면이 버벅이면 꺼 보세요.",
        ),
        h(
          "div",
          { class: "setting-row column" },
          h("strong", null, "TURN 서버 (선택)"),
          h("p", { class: "hint" }, "다른 네트워크끼리 연결이 안 될 때만 넣으세요. 다음에 방에 들어갈 때부터 적용돼요."),
          h(
            "div",
            { class: "turn-fields" },
            text("turnUrl", { placeholder: "turn:example.com:3478", class: "turn-url" }),
            text("turnUser", { placeholder: "사용자 이름", autocomplete: "off" }),
            text("turnPass", { type: "password", placeholder: "비밀번호", autocomplete: "new-password" }),
          ),
        ),
        h(
          "div",
          { class: "setting-row column" },
          h("strong", null, "시그널링 릴레이 (고급)"),
          h(
            "p",
            { class: "hint" },
            "방 목록이 안 뜰 때만 바꾸세요. 한 줄에 wss:// 주소 하나씩, 비우면 기본 목록을 써요. 같이 할 사람 모두 같은 값을 넣어야 해요. 앱을 다시 열면 적용돼요.",
          ),
          relays,
        ),
        status,
    );
    el.classList.add("game-panel");
    root.append(el);
  }
}
