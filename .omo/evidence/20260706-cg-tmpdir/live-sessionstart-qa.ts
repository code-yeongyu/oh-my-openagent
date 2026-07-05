import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { executeCodegraphSessionStartHook } from "../../../packages/omo-codex/plugin/components/codegraph/src/hook.ts";

const evidenceDir = ".omo/evidence/20260706-cg-tmpdir";
const isolatedRoot = mkdtempSync(join(tmpdir(), "omo-codex-qa-cg-"));
const isolatedHome = join(isolatedRoot, "home");
const isolatedCodexHome = join(isolatedRoot, "codex");
const tmpProject = mkdtempSync(join(tmpdir(), "omo-cg-live-excluded-"));
const normalProject = mkdtempSync(join(process.cwd(), ".tmp-cg-live-included-"));
mkdirSync(isolatedHome, { recursive: true });
mkdirSync(isolatedCodexHome, { recursive: true });

const config = { codegraph: { enabled: true }, sources: [], warnings: [] };
const env = { CODEX_HOME: isolatedCodexHome, HOME: isolatedHome };
const tmpStdout: string[] = [];
const normalStdout: string[] = [];
const probes: string[] = [];
const spawns: Array<{ readonly scenario: string; readonly command?: string; readonly args?: readonly string[] }> = [];

try {
  const tmpResult = await executeCodegraphSessionStartHook({
    config,
    cwd: process.cwd(),
    env,
    stdin: Readable.from([JSON.stringify({ cwd: tmpProject })]),
    stdout: { write: (chunk) => tmpStdout.push(chunk) },
    statusProbe: () => {
      probes.push("tmp");
      return Promise.resolve(false);
    },
    spawnWorker: (invocation) => spawns.push({ scenario: "tmp", command: invocation.command, args: invocation.args }),
  });

  const normalResult = await executeCodegraphSessionStartHook({
    config,
    cwd: process.cwd(),
    env,
    stdin: Readable.from([JSON.stringify({ cwd: normalProject })]),
    stdout: { write: (chunk) => normalStdout.push(chunk) },
    statusProbe: () => {
      probes.push("normal");
      return Promise.resolve(false);
    },
    spawnWorker: (invocation) => spawns.push({ scenario: "normal", command: invocation.command, args: invocation.args }),
  });

  const pass = tmpResult.action === "skipped-excluded"
    && tmpStdout.join("") === ""
    && !probes.includes("tmp")
    && spawns.every((spawn) => spawn.scenario !== "tmp")
    && normalResult.action === "spawned"
    && probes.includes("normal")
    && spawns.some((spawn) => spawn.scenario === "normal")
    && normalStdout.join("").includes("LazyCodex CodeGraph bootstrap scheduled in background");

  const beforeCleanup = { isolatedRoot: existsSync(isolatedRoot), tmpProject: existsSync(tmpProject), normalProject: existsSync(normalProject) };
  rmSync(tmpProject, { force: true, recursive: true });
  rmSync(normalProject, { force: true, recursive: true });
  rmSync(isolatedRoot, { force: true, recursive: true });
  const afterCleanup = { isolatedRoot: existsSync(isolatedRoot), tmpProject: existsSync(tmpProject), normalProject: existsSync(normalProject) };

  await Bun.write(join(evidenceDir, "live-sessionstart-proof.json"), `${JSON.stringify({
    pass,
    scenario: "executeCodegraphSessionStartHook with isolated HOME/CODEX_HOME",
    realOsTmpdir: tmpdir(),
    tmpProject,
    tmpResult,
    tmpStdout: tmpStdout.join(""),
    normalProject,
    normalResult,
    normalStdout: normalStdout.join(""),
    probes,
    spawns,
    isolatedHome,
    isolatedCodexHome,
    cleanup: { beforeCleanup, afterCleanup },
  }, null, 2)}\n`);
  if (!pass) process.exit(1);
} catch (error) {
  rmSync(tmpProject, { force: true, recursive: true });
  rmSync(normalProject, { force: true, recursive: true });
  rmSync(isolatedRoot, { force: true, recursive: true });
  throw error;
}
