import * as THREE from "three";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { BONES, DISPLAY_JOINTS, J } from "../pose/joints";
import { anchorOf, type Anchor, type Joint, type NormPose } from "../pose/normalize";

const HIDDEN = -1e5;
const MAX_MARKERS = 17;

interface SkeletonStyle {
  color: number;
  lineWidth: number;
  opacity: number;
}

/** 스켈레톤 하나 (뼈대 선 + 관절 점 + 판정 관절 마커/어프로치 링) */
export class SkeletonView {
  readonly group = new THREE.Group();
  private lineGeo = new LineSegmentsGeometry();
  private lineMat: LineMaterial;
  private joints: THREE.InstancedMesh;
  private markers: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private jointMat: THREE.MeshBasicMaterial;
  private markerMat: THREE.MeshBasicMaterial;
  private ringMat: THREE.MeshBasicMaterial;
  private dummy = new THREE.Object3D();
  private points: Joint[] | null = null;
  private scale = 1;

  constructor(style: SkeletonStyle, renderOrder: number) {
    this.lineGeo.setPositions(new Float32Array(BONES.length * 6));
    this.lineMat = new LineMaterial({
      color: style.color,
      linewidth: style.lineWidth,
      transparent: true,
      opacity: style.opacity,
      depthTest: false,
    });
    const lines = new LineSegments2(this.lineGeo, this.lineMat);
    lines.frustumCulled = false;

    const circle = new THREE.CircleGeometry(1, 24);
    this.jointMat = new THREE.MeshBasicMaterial({
      color: style.color,
      transparent: true,
      opacity: style.opacity,
      depthTest: false,
    });
    this.joints = new THREE.InstancedMesh(circle, this.jointMat, DISPLAY_JOINTS.length);

    this.markerMat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false });
    this.markers = new THREE.InstancedMesh(circle, this.markerMat, MAX_MARKERS);
    this.markers.count = 0;

    this.ringMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.82, 1, 32), this.ringMat, MAX_MARKERS);
    this.rings.count = 0;

    for (const m of [lines, this.joints, this.markers, this.rings]) {
      m.frustumCulled = false;
      m.renderOrder = renderOrder;
      this.group.add(m);
    }
    this.group.visible = false;
  }

  setResolution(w: number, h: number) {
    this.lineMat.resolution.set(w, h);
  }

  set opacity(v: number) {
    this.lineMat.opacity = v;
    this.jointMat.opacity = v;
    this.markerMat.opacity = Math.min(1, v * 1.2);
  }

  /**
   * @param points 화면 픽셀 좌표
   * @param scale 몸통 길이(px) — 점 크기 기준
   */
  setPoints(points: Joint[] | null, scale: number, minVis = 0.4) {
    this.points = points;
    this.scale = scale;
    this.group.visible = points !== null;
    if (!points) return;

    const buf = (this.lineGeo.attributes.instanceStart as THREE.InterleavedBufferAttribute).data;
    const arr = buf.array as Float32Array;
    BONES.forEach(([a, b], i) => {
      const pa = points[a];
      const pb = points[b];
      const ok = pa.v >= minVis && pb.v >= minVis;
      arr.set(ok ? [pa.x, -pa.y, 0, pb.x, -pb.y, 0] : [HIDDEN, HIDDEN, 0, HIDDEN, HIDDEN, 0], i * 6);
    });
    buf.needsUpdate = true;

    DISPLAY_JOINTS.forEach((j, i) => {
      const p = points[j];
      const r = (j === J.NOSE ? 0.07 : 0.045) * scale;
      this.place(this.joints, i, p, p.v >= minVis ? r : 0);
    });
    this.joints.instanceMatrix.needsUpdate = true;
  }

  /**
   * 판정 관절 강조.
   * @param ringT 어프로치 링 크기 (1 = 판정 시점, 클수록 멀리 있음). null이면 링 숨김
   */
  setMarkers(joints: number[], colors: THREE.Color[], ringT: number | null) {
    const pts = this.points;
    if (!pts) {
      this.markers.count = 0;
      this.rings.count = 0;
      return;
    }
    const n = Math.min(joints.length, MAX_MARKERS);
    this.markers.count = n;
    this.rings.count = ringT === null ? 0 : n;
    for (let i = 0; i < n; i++) {
      const p = pts[joints[i]];
      this.place(this.markers, i, p, 0.09 * this.scale);
      this.markers.setColorAt(i, colors[i]);
      if (ringT !== null) {
        this.place(this.rings, i, p, 0.12 * this.scale * (1 + ringT * 2.5));
        this.rings.setColorAt(i, colors[i]);
      }
    }
    for (const m of [this.markers, this.rings]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  private place(mesh: THREE.InstancedMesh, i: number, p: { x: number; y: number }, r: number) {
    this.dummy.position.set(p.x, -p.y, 0);
    this.dummy.scale.setScalar(Math.max(r, 1e-4));
    this.dummy.updateMatrix();
    mesh.setMatrixAt(i, this.dummy.matrix);
  }
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 웹캠 영상 위에 겹쳐 그리는 three.js 레이어.
 * 영상은 <video>로 깔고(거울 반전, contain), 캔버스는 투명하게 덮는다.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
  readonly ghost = new SkeletonView({ color: 0xff5a36, lineWidth: 8, opacity: 0.55 }, 0);
  readonly player = new SkeletonView({ color: 0xffffff, lineWidth: 4, opacity: 0.85 }, 1);

  /** 화면 기준 플레이어 위치 (부드럽게 보간됨) */
  playerAnchor: Anchor | null = null;
  rect: Rect = { x: 0, y: 0, w: 1, h: 1 };

  private video: HTMLVideoElement;

  constructor(container: HTMLElement, video: HTMLVideoElement) {
    this.video = video;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);
    this.scene.add(this.ghost.group, this.player.group);
    this.resize();
    window.addEventListener("resize", () => this.resize());
    video.addEventListener("loadedmetadata", () => this.resize());
  }

  resize() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.renderer.setSize(W, H);
    this.camera.right = W;
    this.camera.bottom = -H;
    this.camera.updateProjectionMatrix();
    this.ghost.setResolution(W, H);
    this.player.setResolution(W, H);

    const vw = this.video.videoWidth || 16;
    const vh = this.video.videoHeight || 9;
    const s = Math.min(W / vw, H / vh);
    this.rect = { w: vw * s, h: vh * s, x: (W - vw * s) / 2, y: (H - vh * s) / 2 };
  }

  /** MediaPipe 이미지 좌표 → 화면 픽셀 (거울 반전) */
  toScreen(lms: NormalizedLandmark[]): Joint[] {
    const r = this.rect;
    return lms.map((l) => ({ x: r.x + (1 - l.x) * r.w, y: r.y + l.y * r.h, v: l.visibility ?? 1 }));
  }

  /** 정규화 포즈 → 화면 픽셀 (anchor 위치/크기에 맞춤, 거울 반전) */
  placeNorm(pose: NormPose, anchor: Anchor): Joint[] {
    return pose.map((p) => ({
      x: anchor.hip.x - p.x * anchor.torso,
      y: anchor.hip.y + p.y * anchor.torso,
      v: p.v,
    }));
  }

  /** 플레이어가 안 보일 때 고스트를 둘 기본 위치 */
  defaultAnchor(): Anchor {
    const r = this.rect;
    return { hip: { x: r.x + r.w / 2, y: r.y + r.h * 0.6 }, torso: r.h * 0.2 };
  }

  /** 플레이어 스켈레톤 갱신 + anchor 보간 */
  updatePlayer(lms: NormalizedLandmark[] | null) {
    if (!lms) {
      this.player.setPoints(null, 1);
      return;
    }
    const pts = this.toScreen(lms);
    const a = anchorOf(pts);
    const prev = this.playerAnchor;
    this.playerAnchor = prev
      ? {
          hip: { x: prev.hip.x + (a.hip.x - prev.hip.x) * 0.3, y: prev.hip.y + (a.hip.y - prev.hip.y) * 0.3 },
          torso: prev.torso + (a.torso - prev.torso) * 0.3,
        }
      : a;
    this.player.setPoints(pts, a.torso);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
