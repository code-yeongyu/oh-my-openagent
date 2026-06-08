import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGitBashCommand } from "./runner";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Git Bash runner", () => {
  it("#given fake bash executable #when command runs #then invokes bash with -lc and command payload", async () => {
    const directory = createTemporaryDirectory("omo-git-bash-runner-");
    const argvPath = join(directory, "argv.txt");
    const fakeBashPath = process.platform === "win32" ? join(directory, "bash.cmd") : join(directory, "bash");
    const fakeBashScript = process.platform === "win32"
      ? [
        "@echo off",
        ">\"%FAKE_BASH_ARGV_PATH%\" echo(%~1",
        ">>\"%FAKE_BASH_ARGV_PATH%\" echo(%~2",
        "echo fake stdout",
        ">&2 echo(fake stderr",
        "exit /b 7",
        "",
      ].join("\r\n")
      : [
        "#!/bin/sh",
        "printf '%s\\n' \"$@\" > \"$FAKE_BASH_ARGV_PATH\"",
        "printf 'fake stdout\\n'",
        "printf 'fake stderr\\n' >&2",
        "exit 7",
        "",
      ].join("\n");
    writeFileSync(fakeBashPath, fakeBashScript);
    if (process.platform !== "win32") {
      chmodSync(fakeBashPath, 0o755);
    }

    const result = await runGitBashCommand({
      bashPath: fakeBashPath,
      command: "printf ok",
      cwd: directory,
      timeoutMs: 5000,
      env: { ...process.env, FAKE_BASH_ARGV_PATH: argvPath },
    });

    expect(readFileSync(argvPath, "utf8").replace(/\r\n/g, "\n")).toBe("-lc\nprintf ok\n");
    const expectedLineEnding = process.platform === "win32" ? "\r\n" : "\n";
    expect(result).toEqual({
      exitCode: 7,
      stdout: `fake stdout${expectedLineEnding}`,
      stderr: `fake stderr${expectedLineEnding}`,
      timedOut: false,
    });
  });
});
