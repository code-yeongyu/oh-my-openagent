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
    const fakeBashPath = join(directory, "bash.exe");
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

    const result = await runGitBashCommand({
      bashPath: fakeBashPath,
      command: "printf ok",
      cwd: directory,
      timeoutMs: 5000,
      env: { ...process.env, FAKE_BASH_ARGV_PATH: argvPath },
    });

    expect(readFileSync(argvPath, "utf8")).toBe("-lc\nprintf ok\n");
    expect(result).toEqual({ exitCode: 7, stdout: "fake stdout\n", stderr: "fake stderr\n", timedOut: false });
  });
});
