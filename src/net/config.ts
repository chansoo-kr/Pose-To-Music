import type { JoinRoomConfig } from "trystero";
import type { Settings } from "../app";
import { sha256Hex } from "../data/hash";

/** Trystero 앱 이름 — 같은 appId끼리만 서로 보인다 */
export const APP_ID = "pose-to-music/v4";
/** 프로토콜 버전. 다르면 방 목록에 안 보이고 참가도 거절된다 */
export const PROTOCOL = 4;

/**
 * 시그널링 릴레이 (Nostr). 모든 사람이 같은 목록을 써야 서로 보인다 — 바꾸면 APP_ID도 올릴 것.
 * Trystero 기본값(appId로 고른 5개)은 AUTH 요구·kind 제한 릴레이가 섞여 방 목록이 안 떴다.
 * 2026-10-22 `pnpm check-relays`로 왕복 확인한 릴레이들.
 */
export const RELAY_URLS = [
  "wss://nos.lol",
  "wss://relay.aarpia.com",
  "wss://nostr.red5d.dev",
  "wss://relay.agentry.com",
  "wss://relay.flashapp.me",
  "wss://testr.nymble.world",
];

/** 설정의 릴레이 입력(한 줄에 하나)을 읽는다. 비었거나 쓸 만한 줄이 없으면 기본 목록 */
export function relayUrls(text: string): string[] {
  const urls = text
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => /^wss:\/\/[^\s]+$/.test(s));
  return urls.length ? [...new Set(urls)] : RELAY_URLS;
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

const MB = 1024 * 1024;
/** 방 만들기에서 고를 수 있는 곡 크기 */
export const MAX_SONG_BYTES = 30 * MB;
/** 받는 쪽 크기 제한 */
export const RECV_SONG_BYTES = 40 * MB;
export const RECV_CHART_BYTES = 1 * MB;
export const RECV_STATE_BYTES = 64 * 1024;
export const RECV_SMALL_BYTES = 16 * 1024;

/** 방장이 한 번에 곡을 보내는 인원 */
export const SONG_SEND_CONCURRENCY = 2;

/** 방 목록: 방장이 방 정보를 다시 알리는 간격 / 소식이 없으면 지우는 시간 */
export const ADVERTISE_MS = 2000;
export const EXPIRE_MS = 8000;
/** 방 코드로 참가할 때 연결을 기다리는 시간 */
export const JOIN_TIMEOUT_MS = 10000;
/** 시작 버튼 → 음악 시작까지 (자리 잡는 시간) */
export const START_DELAY_MS = 6000;
/** 곡이 끝난 뒤 결과를 기다리는 시간 */
export const RESULT_GRACE_MS = 8000;

export const LOBBY_ROOM = "lobby";
export const gameRoomId = (code: string) => `room-${code}`;

export function roomConfig(settings: Settings, password?: string): JoinRoomConfig {
  const config: JoinRoomConfig = { appId: APP_ID, relayConfig: { urls: relayUrls(settings.relays) } };
  if (password) config.password = password;
  const url = settings.turnUrl.trim();
  if (url) {
    config.turnConfig = [
      {
        urls: url,
        ...(settings.turnUser ? { username: settings.turnUser } : {}),
        ...(settings.turnPass ? { credential: settings.turnPass } : {}),
      },
    ];
  }
  return config;
}

/** 방 코드: UUID 앞 8자리 */
export const newRoomCode = () => crypto.randomUUID().slice(0, 8);

/** 비밀번호 확인용 값 — 비밀번호 자체는 보내지 않는다 */
export const passwordProof = (code: string, password: string) => sha256Hex(`${code}:${password}`);
