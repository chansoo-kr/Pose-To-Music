import { joinRoom, type Room } from "trystero";
import type { Settings } from "../app";
import { channel, request } from "./channel";
import { ADVERTISE_MS, EXPIRE_MS, LOBBY_ROOM, RECV_SMALL_BYTES, passwordProof, roomConfig } from "./config";
import { parseCheck, parseRoomInfo, type CheckReq, type CheckRes, type RoomInfo } from "./protocol";

/*
 * 로비 방: Trystero에는 방 목록 기능이 없어서, 모두가 같은 "lobby" 방에 들어가
 * 방장들이 자기 방 정보를 알린다.
 * 목록 보는 사람도 일반 피어로 들어간다 (v3는 passive였지만, Nostr announce가 60초 간격이라
 * 방이 만들어진 뒤에 목록을 열면 최대 1분 동안 아무것도 안 보였다). 목록 보는 사람끼리도
 * 연결되지만, 로비에 머무는 시간이 짧고 인원이 적어서 괜찮다.
 */

/** 방장 쪽: 방 정보를 주기적으로 알리고, 참가 전 비밀번호 확인에 답한다 */
export class LobbyHost {
  private room: Room;
  private timer: number;

  constructor(settings: Settings, getInfo: () => RoomInfo, check: (req: CheckReq) => CheckRes | Promise<CheckRes>) {
    this.room = joinRoom(roomConfig(settings), LOBBY_ROOM);
    const info = channel<RoomInfo>(this.room, "info", RECV_SMALL_BYTES);
    const checker = request<CheckReq, CheckRes>(this.room, "check", RECV_SMALL_BYTES);
    checker.answer((data) => {
      const req = parseCheck(data);
      return req ? check(req) : "gone";
    });
    // 다른 방장의 알림은 무시
    info.on(() => {});
    this.room.onPeerJoin = (peerId) => void info.send(getInfo(), peerId);
    this.timer = window.setInterval(() => void info.send(getInfo()), ADVERTISE_MS);
  }

  close() {
    window.clearInterval(this.timer);
    void this.room.leave();
  }
}

export interface ListedRoom {
  info: RoomInfo;
  peerId: string;
  seen: number;
}

/** 목록 보는 쪽 */
export class LobbyBrowser {
  onChange: (() => void) | null = null;
  private room: Room;
  private rooms = new Map<string, ListedRoom>();
  private timer: number;
  private checker;

  constructor(settings: Settings) {
    // passive로 들어가면 방장의 다음 announce(Nostr는 60초 간격)를 들을 때까지 아무것도 못 본다.
    // 일반 피어로 들어가 내가 먼저 알려야 방장이 바로 연결해 온다.
    this.room = joinRoom(roomConfig(settings), LOBBY_ROOM);
    const info = channel<RoomInfo>(this.room, "info", RECV_SMALL_BYTES);
    this.checker = request<CheckReq, CheckRes>(this.room, "check", RECV_SMALL_BYTES);
    info.on((data, peerId) => {
      const room = parseRoomInfo(data);
      // 방장 본인이 보낸 정보만 믿는다
      if (!room || room.hostId !== peerId) return;
      this.rooms.set(room.code, { info: room, peerId, seen: performance.now() });
      this.onChange?.();
    });
    this.room.onPeerLeave = (peerId) => {
      for (const [code, r] of this.rooms) if (r.peerId === peerId) this.rooms.delete(code);
      this.onChange?.();
    };
    this.timer = window.setInterval(() => {
      const now = performance.now();
      let changed = false;
      for (const [code, r] of this.rooms) {
        if (now - r.seen > EXPIRE_MS) {
          this.rooms.delete(code);
          changed = true;
        }
      }
      if (changed) this.onChange?.();
    }, 1000);
  }

  /** 대기 중인 방 먼저, 그다음 이름순 */
  list(): ListedRoom[] {
    return [...this.rooms.values()].sort(
      (a, b) =>
        Number(a.info.playing || a.info.players >= a.info.max) - Number(b.info.playing || b.info.players >= b.info.max) ||
        a.info.name.localeCompare(b.info.name),
    );
  }

  get(code: string) {
    return this.rooms.get(code);
  }

  /** 참가 전에 방장에게 비밀번호·자리를 확인한다 */
  async check(code: string, password: string): Promise<CheckRes | "timeout"> {
    const room = this.rooms.get(code);
    if (!room) return "gone";
    try {
      const res = await this.checker.ask({ code, proof: await passwordProof(code, password) }, room.peerId);
      return (["ok", "wrong", "full", "playing", "gone"] as const).find((r) => r === res) ?? "gone";
    } catch {
      return "timeout";
    }
  }

  close() {
    window.clearInterval(this.timer);
    this.onChange = null;
    void this.room.leave();
  }
}
