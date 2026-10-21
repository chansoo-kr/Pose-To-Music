import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

export type ModelVariant = "lite" | "full";
export type Delegate = "GPU" | "CPU";

const WASM_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`;
const modelPath = (v: ModelVariant) =>
  `${import.meta.env.BASE_URL}mediapipe/models/pose_landmarker_${v}.task`;

export type FrameListener = (lms: NormalizedLandmark[] | null) => void;

/**
 * 웹캠 + MediaPipe Pose Landmarker.
 * GPU delegate(WebGL2)로 먼저 시도하고, 실패하면 CPU(WASM)로 폴백한다.
 */
export class PoseTracker {
  readonly video: HTMLVideoElement;
  delegate: Delegate | null = null;
  model: ModelVariant | null = null;

  /** 가장 최근 프레임의 랜드마크 (사람이 없으면 null) */
  latest: NormalizedLandmark[] | null = null;
  fps = 0;
  inferMs = 0;

  private landmarker: PoseLandmarker | null = null;
  private listeners = new Set<FrameListener>();
  private lastTs = -1;
  private frameCount = 0;
  private fpsWindowStart = performance.now();
  private running = false;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  get aspect() {
    return this.video.videoWidth / this.video.videoHeight || 16 / 9;
  }

  get ready() {
    return this.landmarker !== null && this.video.readyState >= 2;
  }

  async startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
  }

  async loadModel(variant: ModelVariant, forceCpu = false) {
    if (this.model === variant && this.landmarker && (this.delegate === "CPU") === forceCpu) return;
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const create = (delegate: Delegate) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath(variant), delegate },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

    let next: PoseLandmarker | null = null;
    if (!forceCpu) {
      try {
        next = await create("GPU");
        this.delegate = "GPU";
      } catch (err) {
        console.warn("GPU delegate 실패, CPU로 폴백", err);
      }
    }
    if (!next) {
      next = await create("CPU");
      this.delegate = "CPU";
    }
    this.landmarker?.close();
    this.landmarker = next;
    this.model = variant;
  }

  onFrame(fn: FrameListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const step = () => {
      if (!this.running) return;
      this.detect();
      this.video.requestVideoFrameCallback(step);
    };
    this.video.requestVideoFrameCallback(step);
  }

  private detect() {
    if (!this.landmarker || this.video.readyState < 2) return;
    // detectForVideo는 단조 증가하는 타임스탬프를 요구한다
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 0.01;
    this.lastTs = ts;

    const t0 = performance.now();
    const result = this.landmarker.detectForVideo(this.video, ts);
    this.inferMs = this.inferMs * 0.9 + (performance.now() - t0) * 0.1;
    this.latest = result.landmarks[0] ?? null;

    this.frameCount++;
    const now = performance.now();
    if (now - this.fpsWindowStart >= 1000) {
      this.fps = (this.frameCount * 1000) / (now - this.fpsWindowStart);
      this.frameCount = 0;
      this.fpsWindowStart = now;
    }

    for (const fn of this.listeners) fn(this.latest);
  }
}
