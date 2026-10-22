import { BONES } from "../pose/joints";

export interface MiniPoseStyle {
  /** 뼈대 색 */
  bone: string;
  /** 강조할 관절 (판정 관절) */
  joints?: number[];
  /** 강조 관절 색 */
  joint?: string;
  /** 머리 점 색 */
  head?: string;
  lineWidth?: number;
  alpha?: number;
}

/** 정규화 좌표 범위: 원점 = 엉덩이, 몸통 = 1. 대략 x ±1.6, y -2.3 ~ 1.9 */
const SPAN_H = 4.4;
const HIP_Y = 0.53;

/**
 * 정규화 포즈([x, y] 배열)를 w×h 안에 그린다. 화면처럼 좌우 반전.
 * ctx는 CSS 픽셀 기준으로 변환돼 있어야 한다 (devicePixelRatio는 호출하는 쪽에서).
 */
export function drawMiniPose(
  ctx: CanvasRenderingContext2D,
  pose: ArrayLike<readonly [number, number] | { x: number; y: number }>,
  w: number,
  h: number,
  style: MiniPoseStyle,
) {
  const scale = h / SPAN_H;
  const px = (i: number) => {
    const p = pose[i];
    return Array.isArray(p) ? (p as readonly [number, number])[0] : (p as { x: number }).x;
  };
  const py = (i: number) => {
    const p = pose[i];
    return Array.isArray(p) ? (p as readonly [number, number])[1] : (p as { y: number }).y;
  };
  const X = (i: number) => w / 2 - px(i) * scale;
  const Y = (i: number) => h * HIP_Y + py(i) * scale;

  ctx.save();
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.strokeStyle = style.bone;
  ctx.lineWidth = style.lineWidth ?? 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (const [a, b] of BONES) {
    ctx.moveTo(X(a), Y(a));
    ctx.lineTo(X(b), Y(b));
  }
  ctx.stroke();

  if (style.joints && style.joint) {
    ctx.fillStyle = style.joint;
    const r = Math.max(1.5, (style.lineWidth ?? 2) * 0.9);
    for (const j of style.joints) {
      ctx.beginPath();
      ctx.arc(X(j), Y(j), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (style.head) {
    ctx.fillStyle = style.head;
    ctx.beginPath();
    ctx.arc(X(0), Y(0), Math.max(2.5, scale * 0.16), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
