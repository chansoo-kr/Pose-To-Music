import type { DataPayload, JsonValue, MessageAction, Room } from "trystero";

type SendOptions = NonNullable<Parameters<MessageAction["send"]>[1]>;

/**
 * Trystero 액션 래퍼.
 * - 받는 크기를 제한한다 (onReceive에서 거절)
 * - 받은 데이터는 unknown — 쓰는 쪽에서 protocol.ts의 parse*()로 검증한다
 */
export function channel<T>(room: Room, name: string, maxBytes: number) {
  const action = room.makeAction<DataPayload>(name, {
    onReceive: ({ byteLength }) => byteLength <= maxBytes,
  });
  return {
    send(data: T, target?: string | string[], opts: Omit<SendOptions, "target"> = {}) {
      return action.send(data as unknown as DataPayload, { ...opts, target: target ?? null }).catch((err: unknown) => {
        console.warn(`[net] ${name} 전송 실패`, err);
      });
    },
    on(fn: (data: unknown, peerId: string, metadata?: JsonValue) => void) {
      action.onMessage = (data, ctx) => fn(data, ctx.peerId, ctx.metadata);
    },
    onProgress(fn: (progress: number, peerId: string) => void) {
      action.onReceiveProgress = (p, ctx) => fn(p, ctx.peerId);
    },
  };
}

/** 요청/응답 액션 */
export function request<Req, Res>(room: Room, name: string, maxBytes: number) {
  const action = room.makeAction<DataPayload, DataPayload>(name, {
    kind: "request",
    onReceive: ({ byteLength }) => byteLength <= maxBytes,
  });
  return {
    ask(data: Req, target: string, timeoutMs = 5000): Promise<unknown> {
      return action.request(data as unknown as DataPayload, { target, timeoutMs });
    },
    answer(fn: (data: unknown, peerId: string) => Res | Promise<Res>) {
      action.onRequest = async (data, ctx) => (await fn(data, ctx.peerId)) as unknown as DataPayload;
    },
  };
}
