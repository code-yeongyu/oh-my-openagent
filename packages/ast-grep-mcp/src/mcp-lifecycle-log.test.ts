import { afterEach, describe, expect, it } from "bun:test";

import { mcpLifecycleLogPath, writeMcpLifecycleLog } from "./mcp-lifecycle-log";

const TMP_ENV_KEYS = ["TMPDIR", "TMP", "TEMP"] as const;
const ORIGINAL_TMP_ENV: Record<string, string | undefined> = Object.fromEntries(
  TMP_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function setTempRoot(path: string): void {
  for (const key of TMP_ENV_KEYS) process.env[key] = path;
}

afterEach(() => {
  for (const key of TMP_ENV_KEYS) {
    const original = ORIGINAL_TMP_ENV[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe("writeMcpLifecycleLog best-effort semantics", () => {
  it("#given an invalid log directory #when logging #then it swallows the fs error and does not throw", () => {
    // given: the temp root resolves under a directory that cannot exist, so both
    // the rotation stat and the append target an unwritable path
    setTempRoot("/omo-ast-grep-mcp-nonexistent-root/no/such/dir");
    expect(mcpLifecycleLogPath()).toContain("omo-ast-grep-mcp-nonexistent-root");

    // when / then
    expect(() => writeMcpLifecycleLog("characterization_event", { attempt: 1 })).not.toThrow();
  });

  it("#given a normal temp directory #when logging #then it does not throw", () => {
    // given the inherited temp root (restored by afterEach)
    expect(() => writeMcpLifecycleLog("characterization_event_ok")).not.toThrow();
  });
});
