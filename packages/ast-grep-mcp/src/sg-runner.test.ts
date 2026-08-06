import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_JSON_RECORD_BYTES,
  MAX_MCP_PAYLOAD_BYTES,
  MAX_STDERR_BYTES,
  spawnSgRunner,
} from "./sg-runner";

const directories: string[] = [];

function fixtureRunner(): { directory: string; executable: string; fixture: string } {
  const directory = mkdtempSync(join(tmpdir(), "omo-sg-runner-"));
  directories.push(directory);
  const fixture = join(directory, "fake-sg.js");
  writeFileSync(fixture, `const fs = require("node:fs");
const mode = process.argv[2];
const rec = (n) => JSON.stringify({ text: "m" + n, file: "/repo/f" + n + ".ts", range: { byteOffset: { start: n, end: n + 1 }, start: { line: 0, column: n }, end: { line: 0, column: n + 1 } }, metaVariables: { single: {}, multi: {} } });
const appendReady = (marker) => fs.appendFileSync(marker + ".ready", "ready\\n");
const startReadyHeartbeat = (marker) => {
  appendReady(marker);
  return setInterval(() => appendReady(marker), 50);
};
if (mode === "complete") { process.stdout.write(rec(2) + "\\n" + rec(1).slice(0, 12)); process.stdout.write(rec(1).slice(12) + "\\n" + rec(3) + "\\n"); }
if (mode === "truncated") process.stdout.write(rec(1) + "\\n{\\\"text\\\":\\\"cut");
if (mode === "oversized") process.stdout.write(JSON.stringify({ text: "x".repeat(${MAX_JSON_RECORD_BYTES} + 1) }) + "\\n");
if (mode === "malformed") process.stdout.write("garbage\\n{bad json}\\n");
if (mode === "invalid-utf8") process.stdout.write(Buffer.from([0xff, 0x0a]));
if (mode === "stderr") process.stderr.write("e".repeat(${MAX_STDERR_BYTES} + 100));
if (mode === "stderr-invalid") process.stderr.write(Buffer.alloc(${MAX_STDERR_BYTES} + 100, 0xff));
if (mode === "stderr-boundary") process.stderr.write(Buffer.concat([Buffer.alloc(${MAX_STDERR_BYTES} - 1, 0x61), Buffer.from("€")]));
if (mode === "exit-1") process.exitCode = 1;
if (mode === "exit-1-warning") { process.stderr.write("WARNING: no matches in ignored files"); process.exitCode = 1; }
if (mode.startsWith("exit-1-controlled-")) {
  const writes = mode === "exit-1-controlled-error"
    ? ["ERROR: nonexistent.ts: No such file or directory"]
    : mode === "exit-1-controlled-flood"
      ? ["W".repeat(${MAX_STDERR_BYTES} + 1), "\\nERROR: operational failure after warning flood"]
      : ["W".repeat(${MAX_STDERR_BYTES} + 1), "\\nER", "ROR: split operational failure"];
  const writeNext = (index) => {
    if (index === writes.length) {
      process.exitCode = 1;
      return;
    }
    process.stderr.write(writes[index], () => setImmediate(() => writeNext(index + 1)));
  };
  writeNext(0);
}
if (mode === "exit-2") { process.stderr.write("invalid language"); process.exitCode = 2; }
if (mode === "many") { for (let i = 0; i < 20; i++) process.stdout.write(rec(i) + "\\n"); setInterval(() => {}, 1000); }
if (mode === "payload-cap") {
  const marker = process.argv[3];
  fs.writeFileSync(marker + ".pid", String(process.pid));
  appendReady(marker);
  let index = 0;
  setInterval(() => {
    appendReady(marker);
    if (index < 8) {
      process.stdout.write(JSON.stringify({ text: "x".repeat(900000), file: "/repo/f" + index + ".ts" }) + "\\n");
      index += 1;
    }
  }, 50);
}
if (mode === "hang") {
  const marker = process.argv[3];
  fs.writeFileSync(marker + ".pid", String(process.pid));
  process.on("SIGTERM", () => fs.writeFileSync(marker + ".term", "SIGTERM"));
  startReadyHeartbeat(marker);
}
`);
  return { directory, executable: process.execPath, fixture };
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 4_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error: unknown) => { clearTimeout(timeout); reject(error); },
    );
  });
}

function waitForFile(directory: string, filename: string, timeoutMs = 2_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const path = join(directory, filename);
    const watcher = watch(directory, () => {
      if (!existsSync(path)) return;
      clearTimeout(timeout);
      watcher.close();
      resolve();
    });
    const timeout = setTimeout(() => {
      watcher.close();
      reject(new Error(`Timed out waiting for ${filename}`));
    }, timeoutMs);
  });
}

async function runControlledExitOne(directory: string, executable: string, fixture: string, mode: string, name: string) {
  const running = spawnSgRunner({ sgPath: executable, args: [fixture, mode], workdir: directory });
  const outcome = running.then(
    (value) => ({ status: "resolved" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
  return await withTimeout(outcome, name);
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("bounded sg NDJSON runner", () => {
  it("#given complete chunked NDJSON #when sg exits #then every record is parsed", async () => {
    const { directory, executable, fixture } = fixtureRunner();
    const result = await spawnSgRunner({ sgPath: executable, args: [fixture, "complete"], workdir: directory, maxMatches: 10 });

    expect(result.records.map((record) => record.text)).toEqual(["m2", "m1", "m3"]);
    expect(result).toMatchObject({ truncated: false, reason: null, salvagedRecords: 0, atLeastMatches: 3 });
  });

  it("#given a partial final line #when sg exits #then complete records are salvaged", async () => {
    const { directory, executable, fixture } = fixtureRunner();
    const result = await spawnSgRunner({ sgPath: executable, args: [fixture, "truncated"], workdir: directory, maxMatches: 10 });

    expect(result.records).toHaveLength(1);
    expect(result).toMatchObject({ truncated: true, reason: "sg_output_truncated", salvagedRecords: 1 });
  });

  it("#given oversized, malformed-only, invalid UTF-8, and empty streams #when read #then failures are classified", async () => {
    const { directory, executable, fixture } = fixtureRunner();
    await expect(spawnSgRunner({ sgPath: executable, args: [fixture, "oversized"], workdir: directory })).rejects.toMatchObject({ code: "OUTPUT_TOO_LARGE" });
    await expect(spawnSgRunner({ sgPath: executable, args: [fixture, "malformed"], workdir: directory })).rejects.toMatchObject({ code: "OUTPUT_PARSE_FAILED" });
    await expect(spawnSgRunner({ sgPath: executable, args: [fixture, "invalid-utf8"], workdir: directory })).rejects.toMatchObject({ code: "ENCODING_ERROR" });
    expect((await spawnSgRunner({ sgPath: executable, args: [fixture], workdir: directory })).records).toEqual([]);
  });

  it("#given sg exit 2 #when no internal termination was requested #then the call rejects as SG_FAILED", async () => {
    const { directory, executable, fixture } = fixtureRunner();

    await expect(spawnSgRunner({ sgPath: executable, args: [fixture, "exit-2"], workdir: directory })).rejects.toMatchObject({
      code: "SG_FAILED",
      stderr: "invalid language",
      durationMs: expect.any(Number),
    });
  });

  it("#given sg run exit 1 #when no matches were found #then the empty result remains successful", async () => {
    const { directory, executable, fixture } = fixtureRunner();
    const result = await spawnSgRunner({ sgPath: executable, args: [fixture, "exit-1"], workdir: directory });

    expect(result).toMatchObject({ records: [], exitCode: 1, truncated: false });
  });

  it("#given sg run exit 1 with an operational diagnostic #when stdout is empty #then the call rejects as SG_FAILED", async () => {
    const { directory, executable, fixture } = fixtureRunner();
    const outcome = await runControlledExitOne(directory, executable, fixture, "exit-1-controlled-error", "exit-1-error");

    expect(outcome).toMatchObject({
      status: "rejected",
      error: {
        code: "SG_FAILED",
        stderr: "ERROR: nonexistent.ts: No such file or directory",
        durationMs: expect.any(Number),
      },
    });
  }, 4_000);

  it("#given an ERROR line after the retained stderr cap #when sg exits 1 #then the call rejects as SG_FAILED", async () => {
    const { directory, executable, fixture } = fixtureRunner();
    const outcome = await runControlledExitOne(directory, executable, fixture, "exit-1-controlled-flood", "exit-1-flood");

    expect(outcome).toMatchObject({ status: "rejected", error: { code: "SG_FAILED", durationMs: expect.any(Number) } });
  }, 4_000);

  it("#given an ERROR prefix split across stderr writes after the cap #when sg exits 1 #then the call rejects as SG_FAILED", async () => {
    const { directory, executable, fixture } = fixtureRunner();
    const outcome = await runControlledExitOne(directory, executable, fixture, "exit-1-controlled-split", "exit-1-split");

    expect(outcome).toMatchObject({ status: "rejected", error: { code: "SG_FAILED" } });
  }, 4_000);

  it("#given sg run exit 1 with a warning only #when stdout is empty #then it remains a valid no-match", async () => {
    const { directory, executable, fixture } = fixtureRunner();
    const result = await spawnSgRunner({ sgPath: executable, args: [fixture, "exit-1-warning"], workdir: directory });

    expect(result).toMatchObject({ records: [], exitCode: 1, stderr: "WARNING: no matches in ignored files" });
  });

  it("#given more than maxMatches #when the extra record arrives #then sg is terminated with an honest lower bound", async () => {
    const { directory, executable, fixture } = fixtureRunner();
    const result = await spawnSgRunner({ sgPath: executable, args: [fixture, "many"], workdir: directory, maxMatches: 2 });

    expect(result.records).toHaveLength(2);
    expect(result).toMatchObject({ truncated: true, reason: "match_limit", atLeastMatches: 3 });
  });

  it("#given records exceeding the aggregate payload cap #when the next record arrives #then output is truncated and the child is terminated", async () => {
    const { directory, executable, fixture } = fixtureRunner();
    const marker = join(directory, "payload-cap-child");
    const ready = waitForFile(directory, "payload-cap-child.ready");
    const running = spawnSgRunner({ sgPath: executable, args: [fixture, "payload-cap", marker], workdir: directory, maxMatches: 500 });
    await ready;

    const result = await withTimeout(running, "payload-capped child exit");

    expect(result).toMatchObject({
      truncated: true,
      reason: "output_cap",
      atLeastMatches: result.records.length + 1,
      maxPayloadBytes: MAX_MCP_PAYLOAD_BYTES,
    });
    expect(Buffer.byteLength(JSON.stringify(result.records), "utf8")).toBeLessThanOrEqual(MAX_MCP_PAYLOAD_BYTES);
    const pid = Number(readFileSync(`${marker}.pid`, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 4_000);

  it("#given excessive stderr #when sg exits #then stderr is capped by UTF-8 bytes", async () => {
    const { directory, executable, fixture } = fixtureRunner();
    const result = await spawnSgRunner({ sgPath: executable, args: [fixture, "stderr"], workdir: directory });
    expect(Buffer.byteLength(result.stderr)).toBe(MAX_STDERR_BYTES);
  });

  it("#given invalid UTF-8 and a split multibyte boundary #when stderr is decoded #then returned UTF-8 stays within the byte cap", async () => {
    const { directory, executable, fixture } = fixtureRunner();
    const invalid = await spawnSgRunner({ sgPath: executable, args: [fixture, "stderr-invalid"], workdir: directory });
    const boundary = await spawnSgRunner({ sgPath: executable, args: [fixture, "stderr-boundary"], workdir: directory });

    expect(Buffer.byteLength(invalid.stderr)).toBeLessThanOrEqual(MAX_STDERR_BYTES);
    expect(boundary.stderr).toBe("a".repeat(MAX_STDERR_BYTES - 1));
    expect(Buffer.byteLength(boundary.stderr)).toBeLessThanOrEqual(MAX_STDERR_BYTES);
  });

  it.skipIf(process.platform === "win32")("#given a child that ignores SIGTERM #when aborted #then SIGKILL follows the grace period and no process remains", async () => {
    const { directory, executable, fixture } = fixtureRunner();
    const marker = join(directory, "child");
    const ready = waitForFile(directory, "child.ready");
    const terminated = waitForFile(directory, "child.term");
    const controller = new AbortController();
    const running = spawnSgRunner({ sgPath: executable, args: [fixture, "hang", marker], workdir: directory, signal: controller.signal, timeoutMs: 5_000 });
    const outcome = running.then(
      (value) => ({ status: "resolved" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await ready;
    controller.abort();

    await terminated;
    expect(await withTimeout(outcome, "aborted child exit")).toMatchObject({ status: "rejected", error: { code: "ABORTED" } });
    expect(readFileSync(`${marker}.term`, "utf8")).toBe("SIGTERM");
    const pid = Number(readFileSync(`${marker}.pid`, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 4_000);

  it.skipIf(process.platform !== "win32")("#given a hung child on Windows #when aborted #then child.kill terminates it without POSIX grace signaling", async () => {
    const { directory, executable, fixture } = fixtureRunner();
    const marker = join(directory, "windows-abort-child");
    const ready = waitForFile(directory, "windows-abort-child.ready");
    const controller = new AbortController();
    const running = spawnSgRunner({ sgPath: executable, args: [fixture, "hang", marker], workdir: directory, signal: controller.signal, timeoutMs: 5_000 });
    const outcome = running.then(
      (value) => ({ status: "resolved" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await ready;
    controller.abort();

    expect(await withTimeout(outcome, "Windows aborted child exit")).toMatchObject({ status: "rejected", error: { code: "ABORTED" } });
    expect(existsSync(`${marker}.term`)).toBe(false);
    const pid = Number(readFileSync(`${marker}.pid`, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 4_000);

  it.skipIf(process.platform === "win32")("#given a hung child #when the whole-call budget expires #then timeout termination is bounded", async () => {
    const { directory, executable, fixture } = fixtureRunner();
    const marker = join(directory, "timeout-child");
    const ready = waitForFile(directory, "timeout-child.ready");
    const terminated = waitForFile(directory, "timeout-child.term");
    const running = spawnSgRunner({ sgPath: executable, args: [fixture, "hang", marker], workdir: directory, timeoutMs: 500 });
    const outcome = running.then(
      (value) => ({ status: "resolved" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await ready;

    await terminated;
    expect(await withTimeout(outcome, "timed-out child exit")).toMatchObject({ status: "rejected", error: { code: "TIMEOUT" } });
    const pid = Number(readFileSync(`${marker}.pid`, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 4_000);

  it.skipIf(process.platform !== "win32")("#given a hung child on Windows #when the whole-call budget expires #then child.kill terminates it without POSIX grace signaling", async () => {
    const { directory, executable, fixture } = fixtureRunner();
    const marker = join(directory, "windows-timeout-child");
    const ready = waitForFile(directory, "windows-timeout-child.ready");
    const running = spawnSgRunner({ sgPath: executable, args: [fixture, "hang", marker], workdir: directory, timeoutMs: 1_000 });
    const outcome = running.then(
      (value) => ({ status: "resolved" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await ready;

    expect(await withTimeout(outcome, "Windows timed-out child exit")).toMatchObject({ status: "rejected", error: { code: "TIMEOUT" } });
    expect(existsSync(`${marker}.term`)).toBe(false);
    const pid = Number(readFileSync(`${marker}.pid`, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 4_000);
});
