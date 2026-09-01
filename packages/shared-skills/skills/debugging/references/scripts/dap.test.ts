import { test, expect, describe } from "bun:test";
import { spawn } from "node:child_process";
import { join } from "node:path";

const dir = import.meta.dir;
const client = join(dir, "dap.mjs");
const fixture = join(dir, "fixture-adapter.mjs");

test("treats Windows drive-letter paths as executable specs, not host-port specs", async () => {
  const { isTcpAdapterSpec } = await import("./dap.mjs");
  expect(isTcpAdapterSpec("C:\\workspace\\fixture-adapter.mjs")).toBe(false);
  expect(isTcpAdapterSpec("127.0.0.1:5678")).toBe(true);
});

function frame(message: unknown) {
  const body = Buffer.from(JSON.stringify(message));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

describe("DAP framing", () => {
  test("parses multiple frames and frames split across chunks", async () => {
    const { DapFrameParser } = await import("./dap.mjs");
    const parser = new DapFrameParser();
    const first = frame({ type: "event", event: "one" });
    const second = frame({ type: "event", event: "two", body: { ok: true } });
    expect(parser.push(Buffer.concat([first, second]))).toEqual([{ type: "event", event: "one" }, { type: "event", event: "two", body: { ok: true } }]);
    const third = frame({ type: "response", seq: 3 });
    expect(parser.push(third.subarray(0, 9))).toEqual([]);
    expect(parser.push(third.subarray(9, 17))).toEqual([]);
    expect(parser.push(third.subarray(17))).toEqual([{ type: "response", seq: 3 }]);
  });
});

function session(...fixtureArgs: string[]) {
  // 300ms request timeout ONLY for the --no-answer session, whose test asserts the
  // timeout classification and needs it to fire fast. Answering sessions get 5s:
  // the vars-8 fixture response is ~130KB over a pipe, and on a loaded Windows CI
  // runner that transfer exceeded 300ms, so the request timed out and TRUNCATED
  // output could never appear (run 33065571760: byte-cap test burned its full
  // 15s wait while vars-7's ~5KB response stayed under 300ms and passed).
  const noAnswer = fixtureArgs.includes("--no-answer");
  const child = spawn("bun", [client], { cwd: dir, env: { ...process.env, DAP_TIMEOUT_MS: noAnswer ? "300" : "5000", ...(noAnswer ? { DAP_FIXTURE_NO_ANSWER: "1" } : {}) } });
  let output = "";
  child.stdout.on("data", data => { output += data.toString(); });
  const api = { child, get output() { return output; }, command(line: string) { child.stdin.write(`${line}\n`); } };
  api.command(`launch ${fixture} /tmp/program.py`);
  return api;
}
async function until(s: ReturnType<typeof session>, predicate: (out: string) => boolean) {
  // 15s, not 3s: the file's first `spawn("bun", ...)` on a cold Windows CI runner
  // (bun.exe cold launch + AV scan + fixture adapter spawn) was observed at just
  // over 3s (dev run 33064234392: first READY wait failed at 3024ms while the
  // warm sessions of later tests passed). `until` returns as soon as the
  // predicate holds, so the raise costs nothing on the green path.
  const deadline = Date.now() + 15_000;
  while (!predicate(s.output) && Date.now() < deadline) await Bun.sleep(10);
  expect(predicate(s.output)).toBe(true);
}

test("full session emits stop snapshot, stack and capped variables", async () => {
  const s = session();
  await until(s, out => out.includes("READY: launch"));
  s.command("break /tmp/program.py:12"); await until(s, out => out.includes("BREAK:"));
  s.command("continue"); await until(s, out => out.includes("STOP: stopped reason=breakpoint threadId=1 main at /tmp/program.py:12:3"));
  s.command("stack"); await until(s, out => out.includes("FRAME\t"));
  s.command("vars 7"); await until(s, out => out.includes("TRUNCATED: rows dropped=150"));
  expect((s.output.match(/^v\d+\t/gm) ?? []).length).toBe(100);
  s.command("terminate"); await until(s, out => out.includes("EXIT:"));
  s.command("quit");
}, 60_000);

test("byte cap reports dropped bytes", async () => {
  const s = session();
  await until(s, out => out.includes("READY: launch"));
  s.command("vars 8"); await until(s, out => out.includes("TRUNCATED: rows dropped=") && out.includes("bytes dropped="));
  s.command("quit");
}, 60_000);

test("unverified breakpoint and timeout are classified", async () => {
  const s = session();
  await until(s, out => out.includes("READY: launch"));
  s.command("break /tmp/unverified.py:9"); await until(s, out => out.includes("ERR: unverified-breakpoint"));
  const t = session("--no-answer");
  await until(t, out => out.includes("ERR: timeout"));
  s.command("quit"); t.command("quit");
}, 60_000);
