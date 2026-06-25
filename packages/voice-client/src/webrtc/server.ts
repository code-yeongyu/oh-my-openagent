import { readFileSync } from "fs";
import { join } from "path";

const PUBLIC_DIR = join(import.meta.dir, "public");

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
};

function fileExt(filePath: string): string {
  return filePath.split(".").pop() ?? "";
}

function make1kHzBeep(sampleRate = 44100, durationMs = 500): ArrayBuffer {
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const buf = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    buf[i] = 0.3 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
  }
  return buf.buffer;
}

type Logger = { log: (...args: unknown[]) => void };
type WsData = { frameCount: number };

export function startServer(
  port = Number(process.env.VOICE_WEBRTC_PORT) || 5174,
  logger: Logger = console,
): { stop: () => void } {
  const beep = make1kHzBeep();

  const server = Bun.serve<WsData>({
    port,
    fetch(req, server) {
      const { pathname } = new URL(req.url);

      if (pathname === "/ws") {
        if (server.upgrade(req, { data: { frameCount: 0 } })) return;
        return new Response("WS upgrade failed", { status: 400 });
      }

      let filePath: string;
      if (pathname === "/" || pathname === "/index.html") {
        filePath = join(PUBLIC_DIR, "index.html");
      } else if (pathname.startsWith("/public/")) {
        const name = pathname.slice("/public/".length);
        if (name.includes("..") || name.includes("/")) {
          return new Response("Forbidden", { status: 403 });
        }
        filePath = join(PUBLIC_DIR, name);
      } else {
        return new Response("Not Found", { status: 404 });
      }

      try {
        const body = readFileSync(filePath);
        const mime = MIME[fileExt(filePath)] ?? "application/octet-stream";
        return new Response(body, { headers: { "Content-Type": mime } });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    },
    websocket: {
      open(ws) {
        logger.log("[webrtc] WS connected");
      },
      message(ws, msg) {
        if (typeof msg === "string") return;
        ws.data.frameCount++;
        const byteLen = msg.byteLength;
        logger.log(
          `[webrtc] frame #${ws.data.frameCount}: ${byteLen} bytes (1ch, 16kHz, s16le)`,
        );
        if (ws.data.frameCount <= 5) {
          ws.send(beep);
        }
      },
      close(ws) {
        logger.log("[webrtc] WS disconnected");
      },
    },
  });

  logger.log(`[webrtc] listening on http://localhost:${port}`);
  return { stop: () => server.stop(true) };
}

if (import.meta.main) {
  startServer();
}
