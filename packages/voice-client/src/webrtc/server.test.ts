import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer } from "./server";

const BASE_PORT = 57500;
let portOffset = 0;
function nextPort() {
  return BASE_PORT + portOffset++;
}

async function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

describe("webrtc server", () => {
  let stop: () => void;

  afterEach(() => {
    try {
      stop?.();
    } catch {}
  });

  it("#given startServer, #when GET /, #then 200 text/html", async () => {
    // given
    const port = nextPort();
    ({ stop } = startServer(port));

    // when
    const res = await fetch(`http://localhost:${port}/`);

    // then
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("#given startServer, #when GET /public/main.js, #then 200 application/javascript", async () => {
    // given
    const port = nextPort();
    ({ stop } = startServer(port));

    // when
    const res = await fetch(`http://localhost:${port}/public/main.js`);

    // then
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
  });

  it("#given WS client connects, #when binary sent, #then frame size logged", async () => {
    // given
    const port = nextPort();
    const logs: string[] = [];
    const logger = { log: (...args: unknown[]) => logs.push(args.join(" ")) };
    ({ stop } = startServer(port, logger));

    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("WS open failed"));
      setTimeout(() => reject(new Error("WS open timeout")), 3000);
    });

    // when
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6]);
    ws.send(payload);
    await delay(200);
    ws.close();

    // then
    const frameLog = logs.find((l) => l.includes("frame #1"));
    expect(frameLog).toBeDefined();
    expect(frameLog).toContain("6 bytes");
  });

  it("#given startServer then stop, #when GET /, #then connection refused", async () => {
    // given
    const port = nextPort();
    ({ stop } = startServer(port));
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);

    // when
    stop();
    await delay(150);

    // then
    let threw = false;
    try {
      await fetch(`http://localhost:${port}/`, {
        signal: AbortSignal.timeout(600),
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
