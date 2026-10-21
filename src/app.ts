import { AudioEngine } from "./audio/player";
import type { ModelVariant } from "./pose/landmarker";
import { PoseTracker } from "./pose/landmarker";
import { Stage } from "./render/stage";
import { h } from "./ui";

export interface Scene {
  /** 플레이어 스켈레톤을 그릴지 (기본: immersive와 같음) */
  showPlayer?: boolean;
  /** 녹화/플레이처럼 카메라를 보여줘야 하는 화면 (기본 false = 메뉴: 카메라 숨김) */
  immersive?: boolean;
  /** 온라인 방 화면 — 이 화면으로 옮길 때는 방을 닫지 않는다 */
  online?: boolean;
  enter(root: HTMLElement): void;
  exit?(): void;
  update?(): void;
}

export interface Settings {
  model: ModelVariant;
  /** 카메라 입력 지연 보정 (ms) */
  latencyMs: number;
  /** 에디터 탭 녹음 보정 (ms) — 키를 누른 시점보다 이만큼 앞에 박자를 찍는다 */
  tapOffsetMs: number;
  /** GPU 가속에 문제가 있을 때 CPU(WASM)로 추론 */
  forceCpu: boolean;
  debug: boolean;
  /** 멀티에서 쓰는 이름 */
  nickname: string;
  /** 멀티 플레이 중 다른 사람 포즈 미니뷰 */
  showPeers: boolean;
  /** 직접 넣는 TURN 서버 (비우면 STUN만) */
  turnUrl: string;
  turnUser: string;
  turnPass: string;
}

const SETTINGS_KEY = "ptm.settings";
const DEFAULT_SETTINGS: Settings = {
  model: "full",
  latencyMs: 80,
  tapOffsetMs: 0,
  forceCpu: false,
  debug: false,
  nickname: "",
  showPeers: true,
  turnUrl: "",
  turnUser: "",
  turnPass: "",
};

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export class App {
  readonly audio = new AudioEngine();
  readonly tracker: PoseTracker;
  readonly stage: Stage;
  readonly settings = loadSettings();
  readonly ui: HTMLElement;
  /** 열려 있는 온라인 방. 온라인 화면이 아닌 곳으로 가면 닫는다 */
  session: { close(): void } | null = null;

  private scene: Scene | null = null;
  private debugEl: HTMLElement;

  constructor(root: HTMLElement) {
    const video = h("video", { id: "camera", autoplay: true, muted: true, playsInline: true });
    const layer = h("div", { id: "stage" });
    this.ui = h("div", { id: "ui" });
    this.debugEl = h("div", { id: "debug" });
    root.append(video, layer, this.ui, this.debugEl);

    this.tracker = new PoseTracker(video);
    this.stage = new Stage(layer, video);

    window.addEventListener("pointerdown", () => this.audio.unlock());
    window.addEventListener("keydown", () => this.audio.unlock());

    const loop = () => {
      this.frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* 무시 */
    }
  }

  go(scene: Scene) {
    this.audio.stop();
    this.scene?.exit?.();
    if (!scene.online && this.session) {
      const session = this.session;
      this.session = null;
      session.close();
    }
    this.ui.replaceChildren();
    this.stage.ghost.setPoints(null, 1);
    this.stage.ghost.setMarkers([], [], null);
    this.scene = scene;
    document.body.dataset.mode = scene.immersive ? "play" : "menu";
    scene.enter(this.ui);
  }

  /** 오디오 시계 기준 "카메라에 찍힌 시점"의 곡 시간 */
  poseSongTime() {
    return this.audio.songTime() - this.settings.latencyMs / 1000;
  }

  private frame() {
    const showPlayer = this.scene?.showPlayer ?? this.scene?.immersive ?? false;
    this.stage.updatePlayer(showPlayer ? this.tracker.latest : null);
    this.scene?.update?.();
    this.stage.render();

    this.debugEl.hidden = !this.settings.debug;
    if (this.settings.debug) {
      const t = this.tracker;
      this.debugEl.textContent =
        `pose ${t.fps.toFixed(0)} fps · infer ${t.inferMs.toFixed(1)} ms · ` +
        `${t.delegate ?? "-"} / ${t.model ?? "-"}` +
        (this.audio.playing ? ` · song ${this.audio.songTime().toFixed(2)}s` : "");
    }
  }
}
