type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: string };

/** 간단한 DOM 생성 헬퍼: h("button", { class: "btn", onclick }, "텍스트") */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = String(v);
      else if (k === "style") el.setAttribute("style", String(v));
      else if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2), v as EventListener);
      } else if (k in el) (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/** 자식을 갈아 끼운다 (null/false는 건너뜀) */
export function setChildren(el: Element, ...children: Child[]) {
  el.replaceChildren();
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

// 24x24 stroke 아이콘 (Lucide 스타일)
const ICONS = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users:
    '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4.1a4 4 0 0 1 0 7.8"/><path d="M22 21a7 7 0 0 0-4-6.3"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  trophy:
    '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  tap: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" opacity=".5"/>',
  pause: '<path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor" stroke="none"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  crown: '<path d="M3 18h18M4 8l4 4 4-7 4 7 4-4-2 10H6z"/>',
  power: '<path d="M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 20): SVGSVGElement {
  const tpl = document.createElement("template");
  tpl.innerHTML =
    `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return tpl.content.firstChild as SVGSVGElement;
}

export function panel(...children: Child[]) {
  return h("div", { class: "panel" }, ...children);
}

export function button(label: string, onclick: () => void, cls = "", iconName?: IconName) {
  return h(
    "button",
    { class: `btn ${cls}`, onclick },
    iconName ? icon(iconName, 18) : null,
    label ? h("span", null, label) : null,
  );
}

/** 아이콘만 있는 버튼 */
export function iconButton(name: IconName, label: string, onclick: () => void, cls = "") {
  return h("button", { class: `icon-btn ${cls}`, onclick, title: label, "aria-label": label }, icon(name));
}

/** 패널 상단: (뒤로가기) + 제목 + (보조 설명) */
export function panelHeader(title: string, opts: { sub?: string; onBack?: () => void } = {}) {
  return h(
    "header",
    { class: "panel-header" },
    opts.onBack ? iconButton("back", "뒤로", opts.onBack) : null,
    h("div", null, h("h2", null, title), opts.sub ? h("div", { class: "panel-sub" }, opts.sub) : null),
  );
}

/** 섹션 라벨 */
export function label(text: string) {
  return h("div", { class: "section-label" }, text);
}

/** 세그먼트 컨트롤 */
export function segmented<T>(
  items: { value: T; label: string; sub?: string }[],
  value: T,
  onChange: (v: T) => void,
) {
  const wrap = h("div", { class: "segmented" });
  const render = (cur: T) =>
    wrap.replaceChildren(
      ...items.map((it) =>
        h(
          "button",
          {
            class: `seg${it.value === cur ? " active" : ""}`,
            onclick: () => {
              onChange(it.value);
              render(it.value);
            },
          },
          it.label,
          it.sub ? h("small", null, it.sub) : null,
        ),
      ),
    );
  render(value);
  return wrap;
}

export const formatTime = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** 0:12.345 형식 */
export const formatTimeMs = (sec: number) =>
  `${Math.floor(sec / 60)}:${(sec % 60).toFixed(3).padStart(6, "0")}`;

export const formatDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
};
