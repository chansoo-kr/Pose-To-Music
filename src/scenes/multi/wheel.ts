import { h } from "../../ui";

interface WheelEntry {
  label: string;
  sub: string;
  color: string;
}

/** 캔버스 돌림판 */
export class Wheel {
  readonly el: HTMLCanvasElement;
  private entries: WheelEntry[];
  private rotation = 0;

  constructor(entries: WheelEntry[]) {
    this.entries = entries;
    this.el = h("canvas", { class: "wheel", width: 640, height: 640 });
    this.draw();
    // 웹폰트가 늦게 로드되면 다시 그린다
    void document.fonts?.ready.then(() => this.draw());
  }

  private get seg() {
    return (Math.PI * 2) / this.entries.length;
  }

  private draw() {
    const ctx = this.el.getContext("2d")!;
    const S = this.el.width;
    const c = S / 2;
    const R = c - 24;
    ctx.clearRect(0, 0, S, S);

    this.entries.forEach((e, i) => {
      const a0 = this.rotation + i * this.seg;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, R, a0, a0 + this.seg);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? "#242424" : "#1d1d1d";
      ctx.fill();
      ctx.strokeStyle = "#2c2c2c";
      ctx.lineWidth = 2;
      ctx.stroke();

      // 바깥쪽에 플레이어 색 띠
      ctx.beginPath();
      ctx.arc(c, c, R - 6, a0 + 0.02, a0 + this.seg - 0.02);
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 8;
      ctx.stroke();

      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(a0 + this.seg / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = "#ececec";
      ctx.font = "600 28px 'Pretendard Variable', system-ui, sans-serif";
      ctx.fillText(e.label.length > 14 ? `${e.label.slice(0, 13)}…` : e.label, R - 30, 4);
      ctx.font = "400 20px 'Pretendard Variable', system-ui, sans-serif";
      ctx.fillStyle = "#9a9a9a";
      ctx.fillText(e.sub, R - 30, 30);
      ctx.restore();
    });

    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.strokeStyle = "#3a3a3a";
    ctx.lineWidth = 2;
    ctx.stroke();

    // 가운데
    ctx.beginPath();
    ctx.arc(c, c, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#ececec";
    ctx.fill();

    // 위쪽 포인터
    ctx.beginPath();
    ctx.moveTo(c - 16, 2);
    ctx.lineTo(c + 16, 2);
    ctx.lineTo(c, 40);
    ctx.closePath();
    ctx.fillStyle = "#ff5a36";
    ctx.fill();
  }

  /** @returns 당첨된 항목 인덱스 */
  spin(onTick: () => void): Promise<number> {
    const start = this.rotation;
    const total = Math.PI * 2 * (5 + Math.random() * 2) + Math.random() * Math.PI * 2;
    const dur = 4200;
    const t0 = performance.now();
    let lastSeg = this.pointerIndex();

    return new Promise((resolve) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / dur);
        const ease = 1 - (1 - t) ** 4;
        this.rotation = start + total * ease;
        this.draw();
        const seg = this.pointerIndex();
        if (seg !== lastSeg) {
          lastSeg = seg;
          onTick();
        }
        if (t < 1) requestAnimationFrame(step);
        else resolve(seg);
      };
      requestAnimationFrame(step);
    });
  }

  /** 위쪽 포인터가 가리키는 항목 */
  private pointerIndex() {
    const TAU = Math.PI * 2;
    const theta = (((-Math.PI / 2 - this.rotation) % TAU) + TAU) % TAU;
    return Math.floor(theta / this.seg) % this.entries.length;
  }
}
