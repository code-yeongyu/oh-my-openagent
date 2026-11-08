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

/**
 * Windows holds the just-exited fake `bash.exe` image open past the child's exit, so removing its
 * directory reports EBUSY/EPERM/ENOTEMPTY for a while. Bun's `rmSync` ignores `maxRetries`, so the
 * retry is manual. The assertions have already run by the time this executes, so once the retries are
 * spent a still-locked directory is left to the OS temp reaper rather than failing a passing test;
 * every other error still throws, and POSIX - where this race does not exist - stays strict.
 */
function removeTemporaryDirectory(directory: string): void {
  const MAX_ATTEMPTS = 10;
  const DELAY_MS = 200;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error: unknown) {
      const code = error !== null && typeof error === "object" && "code" in error ? (error as { code: string }).code : "";
      const lockRace = code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
      if (!lockRace) throw error;
      if (attempt + 1 >= MAX_ATTEMPTS) {
        if (process.platform === "win32") return;
        throw error;
      }
      Bun.sleepSync(DELAY_MS);
    }
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) removeTemporaryDirectory(directory);
});

describe("Git Bash runner", () => {
  // Windows CI compiles a fake bash.exe via Bun.build and then spawns it; both
  // steps are much slower than the 5 s Bun default on the shared runners.
  it("#given fake bash executable #when command runs #then invokes bash with -lc and command payload", async () => {
    const directory = createTemporaryDirectory("omo-git-bash-runner-");
    const argvPath = join(directory, "argv.txt");
    const fakeBashPath = join(directory, process.platform === "win32" ? "bash.exe" : "bash");
    if (process.platform === "win32") {
      const fixturePath = join(directory, "fake-bash.ts");
      writeFileSync(
        fixturePath,
        [
          'import { writeFileSync } from "node:fs";',
          'writeFileSync(process.env.FAKE_BASH_ARGV_PATH!, process.argv.slice(2).join("\\r\\n") + "\\r\\n");',
          'process.stdout.write("fake stdout\\r\\n");',
          'process.stderr.write("fake stderr\\r\\n");',
          "process.exit(7);",
          "",
        ].join("\n"),
      );
      const build = await Bun.build({ entrypoints: [fixturePath], compile: { outfile: fakeBashPath } });
      if (!build.success) throw new Error(build.logs.map((log) => log.message).join("\n"));
    } else {
      writeFileSync(
        fakeBashPath,
        [
          "#!/bin/sh",
          "printf '%s\\n' \"$@\" > \"$FAKE_BASH_ARGV_PATH\"",
          "printf 'fake stdout\\n'",
          "printf 'fake stderr\\n' >&2",
          "exit 7",
          "",
        ].join("\n"),
      );
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
  }, { timeout: 30_000 });
});
