import type { App, Scene } from "../../app";
import { LobbyBrowser, type ListedRoom } from "../../net/lobby";
import { LENIENCY_LABEL } from "../../game/scoring";
import { relayStatus, relayText } from "../../net/relays";
import { NetRoom } from "../../net/room";
import { MODE_LABEL } from "./lobby";
import { DIFFICULTY_LABEL } from "../../pose/joints";
import { button, h, icon, panel, panelHeader, setChildren } from "../../ui";
import { createRoom, OnlineEntryScene } from "./entry";
import { OnlineSession } from "./session";

/** 이 시간 동안 방이 안 보이면 "없어요"로 바꾼다 */
const SEARCH_MS = 15000;

const CHECK_TEXT = {
  wrong: "비밀번호가 맞지 않아요.",
  full: "방이 가득 찼어요.",
  playing: "이미 게임 중인 방이에요.",
  gone: "방이 사라졌어요.",
  timeout: "방장이 응답하지 않아요.",
} as const;

/** 방 목록 (로비 방에서 방장들이 알리는 정보) + 방 코드로 참가 */
export class RoomsScene implements Scene {
  private app: App;
  private message: string;
  private browser: LobbyBrowser | null = null;
  private timer = 0;

  constructor(app: App, message = "") {
    this.app = app;
    this.message = message;
  }

  exit() {
    window.clearInterval(this.timer);
    this.browser?.close();
  }

  enter(root: HTMLElement) {
    const { app } = this;
    let browser!: LobbyBrowser;
    let searchFrom = 0;
    const list = h("div", { class: "room-list" });
    const relay = h("div", { class: "relay-status" });
    const msg = h("p", { class: "warn" }, this.message);
    const dialog = h("div");
    let busy = false;

    const join = async (code: string, password: string, hostId: string | null) => {
      if (busy) return;
      busy = true;
      msg.textContent = "";
      try {
        const net = await NetRoom.join(app, code, password, hostId);
        new OnlineSession(app, net).openLobby();
      } catch (err) {
        console.error(err);
        msg.textContent = `참가 실패: ${err instanceof Error ? err.message : String(err)}`;
        busy = false;
      }
    };

    /** 방장에게 먼저 확인하고 참가 */
    const tryJoin = async (room: ListedRoom, password: string) => {
      msg.textContent = "확인 중…";
      const res = await browser.check(room.info.code, password);
      if (res === "ok") return join(room.info.code, password, room.peerId);
      msg.textContent = CHECK_TEXT[res];
      if (res === "wrong") askPassword(room);
    };

    const askPassword = (room: ListedRoom) => {
      const input = h("input", { type: "password", placeholder: "비밀번호", maxLength: 32 });
      const ok = () => {
        dialog.replaceChildren();
        void tryJoin(room, input.value);
      };
      input.addEventListener("keydown", (e) => e.key === "Enter" && ok());
      dialog.replaceChildren(
        h(
          "div",
          { class: "inline-dialog" },
          icon("lock", 18),
          h("strong", null, room.info.name),
          input,
          button("참가", ok, "primary small"),
          button("취소", () => dialog.replaceChildren(), "small"),
        ),
      );
      input.focus();
    };

    const renderEmpty = () => {
      const relays = relayStatus();
      const elapsed = performance.now() - searchFrom;
      const actions = h(
        "div",
        { class: "row center" },
        button("방 만들기", () => createRoom(app), "primary", "plus"),
        elapsed >= SEARCH_MS ? button("다시 찾기", restart, "", "refresh") : null,
      );
      if (relays.total && !relays.open && elapsed >= 5000) {
        setChildren(
          list,
          h(
            "div",
            { class: "empty bad" },
            h("strong", null, "시그널링 서버에 연결하지 못했어요."),
            h("p", null, "인터넷 연결을 확인하거나, 설정 > 멀티에서 시그널링 릴레이를 바꿔 보세요."),
            actions,
          ),
        );
      } else if (elapsed < SEARCH_MS) {
        setChildren(
          list,
          h(
            "div",
            { class: "empty" },
            h("p", null, h("span", { class: "spinner" }), ` 열린 방을 찾는 중… ${Math.floor(elapsed / 1000)}초`),
            actions,
          ),
        );
      } else {
        setChildren(
          list,
          h(
            "div",
            { class: "empty" },
            h("strong", null, "열린 방이 없어요."),
            h("p", null, "친구 방이 안 보이면 방 코드로 참가하세요."),
            actions,
          ),
        );
      }
    };

    const render = () => {
      const rooms = browser.list();
      if (!rooms.length) return renderEmpty();
      setChildren(
        list,
        ...rooms.map((room) => {
          const r = room.info;
          const full = r.players >= r.max;
          const state = r.playing ? "게임 중" : full ? "가득" : "대기";
          return h(
            "button",
            {
              class: `room-row${r.playing || full ? " closed" : ""}`,
              disabled: r.playing || full,
              onclick: () => (r.locked ? askPassword(room) : void tryJoin(room, "")),
            },
            h("span", { class: "room-lock" }, r.locked ? icon("lock", 16) : null),
            h(
              "span",
              { class: "room-main" },
              h("span", { class: "room-name" }, r.name),
              h(
                "span",
                { class: "room-meta" },
                [MODE_LABEL[r.mode], r.song, DIFFICULTY_LABEL[r.level], r.leniency === "normal" ? "" : `판정 ${LENIENCY_LABEL[r.leniency]}`, `방장 ${r.host}`]
                  .filter(Boolean)
                  .join(" · "),
              ),
            ),
            h("span", { class: "room-count" }, `${r.players}/${r.max}`),
            h("span", { class: `room-state${r.playing ? " playing" : full ? " full" : ""}` }, state),
          );
        }),
      );
    };
    /** 로비 방에 (다시) 들어가 찾기 시작 */
    const start = () => {
      browser = this.browser = new LobbyBrowser(app.settings);
      browser.onChange = render;
      searchFrom = performance.now();
      render();
    };
    const restart = () => {
      browser.close();
      start();
    };
    start();

    // 릴레이 상태와 "찾는 중… n초"는 1초마다 갱신
    const tick = () => {
      const r = relayText(relayStatus());
      relay.className = `relay-status ${r.cls}`;
      relay.textContent = r.text;
      if (!browser.list().length) renderEmpty();
    };
    tick();
    this.timer = window.setInterval(tick, 1000);

    // 방 코드로 참가
    const code = h("input", { placeholder: "방 코드", maxLength: 8, class: "code-input" });
    const pw = h("input", { type: "password", placeholder: "비밀번호 (있으면)", maxLength: 32 });
    const byCode = () => {
      const c = code.value.trim().toLowerCase();
      if (!/^[0-9a-f]{8}$/.test(c)) {
        msg.textContent = "방 코드는 8자리예요.";
        return;
      }
      msg.textContent = "연결 중…";
      void join(c, pw.value, null);
    };

    const el = panel(
      h("div", { class: "panel-top" }, panelHeader("방 목록", { onBack: () => app.go(new OnlineEntryScene(app)), sub: "누르면 참가해요" }), relay),
      list,
      dialog,
      msg,
      h(
        "details",
        { class: "code-join" },
        h("summary", null, icon("back", 16), "방 코드로 참가"),
        h("div", { class: "row left" }, code, pw, button("참가", byCode, "small")),
        h("p", { class: "hint" }, "목록에 방이 안 보이면 방장에게 방 코드를 받아 입력하세요."),
      ),
    );
    el.classList.add("wide", "game-panel");
    root.append(el);
  }
}
