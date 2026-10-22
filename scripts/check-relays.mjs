// 시그널링 릴레이(Nostr) 점검: 구독 소켓과 발행 소켓을 따로 열어, Trystero가 만드는 것과 같은 이벤트가
// 되돌아오는지 본다. 방 목록이 안 뜰 때 가장 먼저 돌려 본다.
//   pnpm check-relays          # src/net/config.ts의 RELAY_URLS
//   pnpm check-relays --all    # Trystero 기본 릴레이 전체도 함께
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Node 20은 전역 WebSocket이 플래그 뒤에 있다
if (!globalThis.WebSocket) {
  const r = spawnSync(process.execPath, ["--experimental-websocket", ...process.argv.slice(1)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const { createEvent, subscribe, defaultRelayUrls } = await import("trystero");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = await readFile(join(root, "src", "net", "config.ts"), "utf8");
const appId = config.match(/APP_ID = "([^"]+)"/)[1];
const ours = [...config.match(/RELAY_URLS = \[([\s\S]*?)\]/)[1].matchAll(/"(wss:\/\/[^"]+)"/g)].map((m) => m[1]);
const urls = process.argv.includes("--all") ? [...new Set([...ours, ...defaultRelayUrls])] : ours;

// Trystero와 같은 방식으로 만든 로비 토픽 (kind가 토픽에서 정해지므로 실제와 같은 kind로 시험된다)
const sha1 = async (s) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s))))
    .map((b) => b.toString(36))
    .join("");
const topics = [await sha1(`Trystero@${appId}@lobby`), `ptm-check-${Math.random().toString(36).slice(2)}`];

const TIMEOUT = 8000;

/** 한 릴레이·한 토픽: 왕복 시간(ms) 또는 실패 이유 */
function probe(url, topic) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sub = new WebSocket(url);
    const pub = new WebSocket(url);
    let done = false;
    let reason = "";
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const ws of [sub, pub]) {
        try {
          ws.close();
        } catch {
          /* 무시 */
        }
      }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: reason || "되돌아오지 않음" }), TIMEOUT);
    let opened = 0;
    const onOpen = async () => {
      if (++opened < 2) return;
      sub.send(subscribe("check", topic));
      await new Promise((r) => setTimeout(r, 800));
      pub.send(await createEvent(topic, JSON.stringify({ peerId: "check" })));
    };
    sub.onopen = pub.onopen = onOpen;
    sub.onerror = pub.onerror = () => finish({ ok: false, reason: "연결 안 됨" });
    sub.onmessage = (m) => {
      const msg = JSON.parse(String(m.data));
      if (msg[0] === "EVENT") finish({ ok: true, ms: Date.now() - t0 });
      else if (msg[0] === "CLOSED") reason = `구독 거절: ${msg[2] ?? ""}`;
      else if (msg[0] === "AUTH") reason = "AUTH 요구";
    };
    pub.onmessage = (m) => {
      const msg = JSON.parse(String(m.data));
      if (msg[0] === "OK" && msg[2] === false) reason = `발행 거절: ${msg[3] ?? ""}`;
      else if (msg[0] === "NOTICE") reason = `NOTICE: ${msg[1]}`;
      else if (msg[0] === "AUTH") reason = "AUTH 요구";
    };
  });
}

console.log(`appId ${appId} · 릴레이 ${urls.length}개 · 토픽 ${topics.length}개 (로비 + 무작위)\n`);
const rows = await Promise.all(
  urls.map(async (url) => ({ url, results: await Promise.all(topics.map((t) => probe(url, t))) })),
);
let good = 0;
for (const { url, results } of rows) {
  const ok = results.every((r) => r.ok);
  if (ok && ours.includes(url)) good++;
  const detail = results.map((r) => (r.ok ? `${r.ms}ms` : r.reason)).join(" | ");
  console.log(`${ok ? "OK  " : "FAIL"} ${ours.includes(url) ? "*" : " "} ${url.padEnd(40)} ${detail}`);
}
console.log(`\n* = RELAY_URLS. 정상 ${good}/${ours.length}`);
process.exit(good ? 0 : 1);
