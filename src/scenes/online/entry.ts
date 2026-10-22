import type { App, Scene } from "../../app";
import { NetRoom } from "../../net/room";
import { NAME_MAX, cleanName } from "../../net/protocol";
import { h, icon, panel, panelHeader } from "../../ui";
import { TitleScene } from "../title";
import { roomFormScene } from "./form";
import { RoomsScene } from "./rooms";
import { OnlineSession } from "./session";

/** 멀티: 닉네임 + 방 만들기 / 방 목록 */
export class OnlineEntryScene implements Scene {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  enter(root: HTMLElement) {
    const { app } = this;
    const s = app.settings;

    const item = (title: string, desc: string, iconName: "plus" | "users", onclick: () => void) =>
      h(
        "button",
        { class: "game-btn tile", onclick, onmouseenter: () => app.audio.sfx("tick") },
        icon(iconName, 28),
        h("span", null, title),
        h("small", null, desc),
      );
    const create = item("방 만들기", "인원·모드·곡을 정하고 방장이 돼요", "plus", () => createRoom(app));
    const browse = item("방 목록", "열린 방에 참가해요", "users", () => app.go(new RoomsScene(app)));

    const refresh = () => {
      const ok = !!cleanName(s.nickname);
      create.disabled = browse.disabled = !ok;
    };
    const nick = h("input", {
      value: s.nickname,
      maxLength: NAME_MAX,
      placeholder: "닉네임",
      oninput: (e: Event) => {
        s.nickname = (e.target as HTMLInputElement).value;
        app.saveSettings();
        refresh();
      },
      onchange: () => {
        s.nickname = cleanName(s.nickname);
        nick.value = s.nickname;
        app.saveSettings();
      },
    });
    refresh();

    const el = panel(
      panelHeader("멀티", { onBack: () => app.go(new TitleScene(app)), sub: "각자 자기 기기에서 같은 방에 모여 동시에 플레이해요" }),
      h("label", { class: "field" }, "닉네임", nick),
      h("div", { class: "tile-row" }, create, browse),
    );
    el.classList.add("game-panel");
    root.append(el);
    if (!s.nickname) nick.focus();
  }
}

/** 방 만들기 → 대기실 */
export function createRoom(app: App) {
  app.go(
    roomFormScene({
      title: "방 만들기",
      submitLabel: "방 만들기",
      initial: {
        name: `${app.settings.nickname}의 방`,
        max: 4,
        mode: "classic",
        level: "normal",
        leniency: "normal",
        password: "",
        songId: null,
        chartId: null,
      },
      onBack: () => app.go(new OnlineEntryScene(app)),
      onSubmit: async (v, song, chart) => {
        const net = await NetRoom.host(app, { ...v, song, chart });
        new OnlineSession(app, net).openLobby();
      },
    }),
  );
}
