import type { App, Scene } from "../../app";
import { LobbyBrowser, type ListedRoom } from "../../net/lobby";
import { NetRoom } from "../../net/room";
import { MODE_LABEL } from "./lobby";
import { DIFFICULTY_LABEL } from "../../pose/joints";
import { button, h, icon, panel, panelHeader, setChildren } from "../../ui";
import { createRoom, OnlineEntryScene } from "./entry";
import { OnlineSession } from "./session";

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

  constructor(app: App, message = "") {
    this.app = app;
    this.message = message;
  }

  exit() {
    this.browser?.close();
  }

  enter(root: HTMLElement) {
    const { app } = this;
    const browser = (this.browser = new LobbyBrowser(app.settings));
    const list = h("div", { class: "room-list" });
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

    const render = () => {
      const rooms = browser.list();
      if (!rooms.length) {
        setChildren(
          list,
          h(
            "div",
            { class: "empty" },
            h("span", { class: "spinner" }),
            " 열린 방을 찾는 중… 없으면 직접 만들어 보세요.",
            h("div", { class: "row center" }, button("방 만들기", () => createRoom(app), "primary", "plus")),
          ),
        );
        return;
      }
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
                [MODE_LABEL[r.mode], r.song, DIFFICULTY_LABEL[r.level], `방장 ${r.host}`].filter(Boolean).join(" · "),
              ),
            ),
            h("span", { class: "room-count" }, `${r.players}/${r.max}`),
            h("span", { class: `room-state${r.playing ? " playing" : full ? " full" : ""}` }, state),
          );
        }),
      );
    };
    browser.onChange = render;
    render();

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
      panelHeader("방 목록", { onBack: () => app.go(new OnlineEntryScene(app)), sub: "누르면 참가해요" }),
      list,
      dialog,
      msg,
      h(
        "details",
        { class: "code-join" },
        h("summary", null, "방 코드로 참가"),
        h("div", { class: "row left" }, code, pw, button("참가", byCode, "small")),
        h("p", { class: "hint" }, "목록에 방이 안 보이면 방장에게 방 코드를 받아 입력하세요."),
      ),
    );
    el.classList.add("wide", "game-panel");
    root.append(el);
  }
}
