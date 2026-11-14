import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootstrapSetup } from "../remote-bootstrap";
import {
  prepareRemoteAttach,
  REMOTE_EXIT,
  type RemoteVerbDependencies,
  runRemoteVerb,
} from "../remote-cli";

// #13405: `--help` is an answer (stdout, exit 0) for `omo remote` and for each verb, and `omo --help` lists `remote`.
// Help never reaches the sign-in check or the device service: every dependency that would contact one throws.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const untouched = (what: string) => () => {
  throw new Error(`help contacted ${what}`);
};

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const dependencies: RemoteVerbDependencies = {
    accountShow: untouched("the sign-in"),
    stateDir: join(tmpdir(), "omo-remote-help-absent"),
    connect: untouched("the device service"),
    now: () => 0,
    output: (line) => out.push(line),
    write: (text) => out.push(text),
    error: (line) => err.push(line),
    bootstrap: {} as BootstrapSetup,
  };
  return { out, err, dependencies };
}

async function usagePrintedOnError(): Promise<string> {
  const { err, dependencies } = capture();
  expect(await runRemoteVerb(dependencies, [])).toBe(REMOTE_EXIT.usage);
  return err.join("\n");
}

// The verbs the usage itself names: the first word of each entry line, with `enable | disable` as two.
function usageVerbs(usage: string): string[] {
  return usage
    .split("\n")
    .filter((line) => /^ {2}[a-z]/.test(line))
    .flatMap(
      (line) =>
        line
          .trim()
          .split(/\s{2,}/)[0]
          ?.split(" | ")
          .map((part) => part.split(" ")[0] ?? "") ?? [],
    );
}

describe("omo remote --help", () => {
  test.each([["--help"], ["-h"], ["help"]])(
    "%p prints the usage the command shows on a usage error, on stdout with exit 0",
    async (flag) => {
      const usage = await usagePrintedOnError();
      const { out, err, dependencies } = capture();
      expect(await runRemoteVerb(dependencies, [flag])).toBe(REMOTE_EXIT.ok);
      expect(err).toEqual([]);
      expect(out.join("\n")).toBe(usage);
    },
  );

  test("every verb the usage names answers <verb> --help and <verb> -h with its own entry, on stdout with exit 0", async () => {
    const usage = await usagePrintedOnError();
    const verbs = usageVerbs(usage);
    expect(verbs).toContain("send");
    for (const verb of verbs) {
      for (const flag of ["--help", "-h"]) {
        const { out, err, dependencies } = capture();
        const code =
          verb === "attach"
            ? await prepareRemoteAttach(dependencies, [flag])
            : await runRemoteVerb(dependencies, [verb, flag]);
        expect([verb, flag, code, err]).toEqual([verb, flag, REMOTE_EXIT.ok, []]);
        const [head, ...entry] = out.join("\n").split("\n");
        expect(head).toBe(usage.split("\n")[0]);
        expect(usageVerbs(entry.join("\n"))).toContain(verb);
        expect(usage).toContain(entry.join("\n"));
      }
    }
  });

  test("--help after a verb's arguments still answers with the verb's usage instead of running it", async () => {
    const { out, dependencies } = capture();
    expect(await runRemoteVerb(dependencies, ["send", "b/s", "hi", "--help"])).toBe(REMOTE_EXIT.ok);
    expect(usageVerbs(out.join("\n"))).toEqual(["send"]);
  });
});

describe("omo --help", () => {
  test("lists remote among the commands", () => {
    const home = mkdtempSync(join(tmpdir(), "omo-help-home-"));
    dirs.push(home);
    const run = spawnSync(
      process.execPath,
      [join(import.meta.dir, "..", "compile-entry.ts"), "--help"],
      {
        encoding: "utf8",
        env: { ...process.env, HOME: home, USERPROFILE: home, OMO_EXTRA_CA_CERTIFICATES: "" },
        timeout: 60_000,
      },
    );
    expect(run.status).toBe(0);
    const commands = run.stdout.split("\n").find((line) => line.startsWith("Commands: "));
    expect(commands?.slice("Commands: ".length).split(", ")).toContain("remote");
  });
});
