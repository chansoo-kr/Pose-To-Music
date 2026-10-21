import type { Scene } from "../../app";
import type { GameMode, MemberState } from "../../net/protocol";
import { DIFFICULTY_LABEL } from "../../pose/joints";
import { button, formatTime, h, icon, panel, setChildren } from "../../ui";
import { roomFormScene } from "./form";
import { onlineScene, type OnlineSession } from "./session";

export const MODE_LABEL: Record<GameMode, string> = { classic: "기본", freestyle: "프리스타일" };

function statusText(m: MemberState) {
  switch (m.status) {
    case "connecting":
      return "연결 중";
    case "downloading":
      return `곡 받는 중 ${Math.round(m.progress * 100)}%`;
    case "loading":
      return "불러오는 중";
    case "waiting":
      return "대기";
    case "ready":
      return "준비";
  }
}

/** 대기실: 참가자 상태, 방 설정, (방장) 시작 / (참가자) 준비 */
export class LobbyScene implements Scene {
  private session: OnlineSession;
  private off: (() => void) | null = null;

  constructor(session: OnlineSession) {
    this.session = session;
  }

  exit() {
    this.off?.();
  }

  enter(root: HTMLElement) {
    const { session } = this;
    const { net, app } = session;
    const body = h("div", { class: "lobby" });
    const el = panel(body);
    el.classList.add("wide", "game-panel");
    root.append(el);

    const copyCode = () => void navigator.clipboard?.writeText(net.code).catch(() => {});

    const editSettings = () => {
      const s = net.state!.settings;
      app.go(
        onlineScene(
          roomFormScene({
            title: "방 설정 바꾸기",
            submitLabel: "적용",
            initial: { ...s, password: "", songId: s.song?.id ?? null, chartId: s.chart?.id ?? null },
            editing: { players: net.members.length },
            onBack: () => session.openLobby(),
            onSubmit: async (v, song, chart) => {
              await net.updateSettings({ ...v, song, chart });
              session.openLobby();
            },
          }),
        ),
      );
    };

    const render = () => {
      const s = net.state;
      if (!s) {
        setChildren(
          body,
          h("div", { class: "lobby-connecting" }, h("span", { class: "spinner" }), `방 ${net.code}에 연결하는 중…`),
          h("div", { class: "row" }, button("취소", () => session.exit())),
        );
        return;
      }
      const set = s.settings;
      const me = net.member(net.selfId);

      const slots: HTMLElement[] = s.members.map((m) =>
        h(
          "li",
          { class: `member status-${m.status}${m.id === net.selfId ? " me" : ""}` },
          h("span", { class: "member-icon" }, m.id === s.hostId ? icon("crown", 18) : icon("user", 18)),
          h("span", { class: "member-name" }, m.name),
          m.status === "downloading"
            ? h("span", { class: "member-bar" }, h("span", { style: `width:${Math.round(m.progress * 100)}%` }))
            : null,
          h("span", { class: "member-status" }, statusText(m)),
          h("span", { class: "member-ping" }, m.id === s.hostId ? "" : m.ping === null ? "-" : `${m.ping}ms`),
        ),
      );
      for (let i = s.members.length; i < set.max; i++) slots.push(h("li", { class: "member empty-slot" }, "빈 자리"));

      const info = (k: string, v: string | Node) => h("div", { class: "info-row" }, h("span", null, k), h("strong", null, v));

      let action: HTMLElement;
      let hint = "";
      if (net.isHost) {
        const others = s.members.filter((m) => m.id !== net.selfId);
        if (!others.length) hint = "다른 사람이 들어오길 기다리는 중…";
        else if (!s.members.every((m) => m.status === "ready")) hint = "모두 준비하면 시작할 수 있어요.";
        action = button("시작", () => session.startRound(), "primary big", "play");
        (action as HTMLButtonElement).disabled = !session.canStart;
      } else {
        const can = me && (me.status === "waiting" || me.status === "ready");
        action = button(net.ready ? "준비 취소" : "준비", () => net.setReady(!net.ready), net.ready ? "big" : "primary big", net.ready ? "x" : "check");
        (action as HTMLButtonElement).disabled = !can;
        if (!can) hint = "곡을 받는 중이에요.";
        else if (!net.ready) hint = "준비를 누르면 방장이 시작할 수 있어요.";
        else hint = "방장이 시작하길 기다리는 중…";
      }

      setChildren(
        body,
        h(
          "header",
          { class: "lobby-head" },
          h(
            "div",
            null,
            h("h2", null, set.name),
            h(
              "button",
              { class: "room-code", title: "방 코드 복사", onclick: copyCode },
              s.locked ? icon("lock", 14) : null,
              `방 코드 ${net.code}`,
              icon("copy", 14),
            ),
          ),
          button("나가기", () => session.exit(), "small", "back"),
        ),
        h(
          "div",
          { class: "lobby-grid" },
          h("ol", { class: "members" }, ...slots),
          h(
            "div",
            { class: "room-info" },
            info("모드", MODE_LABEL[set.mode]),
            info("곡", set.song ? `${set.song.title} (${formatTime(set.song.durationSec)})` : "-"),
            set.mode === "classic" ? info("채보", set.chart ? `${set.chart.author || "이름 없음"} · 포즈 ${set.chart.poses}개` : "-") : null,
            info("난이도", DIFFICULTY_LABEL[set.level]),
            info("인원", `${s.members.length} / ${set.max}`),
            net.isHost ? button("설정 바꾸기", editSettings, "small", "settings") : null,
          ),
        ),
        session.notice ? h("p", { class: "warn" }, session.notice) : null,
        h("div", { class: "lobby-foot" }, h("span", { class: "hint" }, hint), action),
      );
    };

    this.off = session.subscribe(render);
    render();
  }
}
