import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const logPath = join(root, ".omo/evidence/20260908-lcx-astra/task-gate-a-remote-tests.log");
const remoteRoot = "/tmp/lcx-gate-a-20260908";
const remoteRepo = `${remoteRoot}/omo`;
const origin = process.env.LCX_ORIGIN;
const expectedHead = process.env.LCX_HEAD;
if (!origin || !expectedHead || !process.env.BUNSHIN_SDK_REPO) throw new Error("Missing landing metadata");
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
appendFileSync(logPath, `\nPR A REMOTE UNIT GATES - corrected SDK read ceiling after setup-only failure; no prior test execution\nDate: ${new Date().toISOString()}\nExpected HEAD: ${expectedHead}\nOrigin: ${origin}\nLocal build: bun run build:codex-install -> exit 0; git status --porcelain EMPTY\nBranch pushed: origin/lcx/astra-default-models\n\n`);
const append = text => appendFileSync(logPath, text);
const { default: client } = await import(`${process.env.BUNSHIN_SDK_REPO}/packages/machine-sdk/src/index.ts`);
let machine;
let owned = false;
let failed = false;
const summaryPattern = /^(?:\s*\d+ (?:pass|fail|skip|todo)\b.*|\s*Ran \d+ tests?\b.*|\s*Test Files\s+.*|\s*Tests\s+.*|\s*# (?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b.*)$/;
async function stage(name, command, cwd) {
  const remoteLog = `${remoteRoot}/logs/${name}.log`;
  append(`\n===== ${name} =====\nCOMMAND: ${command}\nCWD: ${cwd}\n`);
  console.log(`REMOTE ${name} START`);
  const result = await machine.shell(`(export TMPDIR=${quote(`${remoteRoot}/tmp`)}; cd ${quote(cwd)} && ${command}) > ${quote(remoteLog)} 2>&1; rc=$?; printf 'COMMAND_EXIT=%s\\n' "$rc"; wc -c < ${quote(remoteLog)}; shasum -a 256 ${quote(remoteLog)}; exit "$rc"`, { timeoutMs: 3_600_000 });
  const bytes = Buffer.from(await machine.readBytes(remoteLog, { limitBytes: 10 * 1024 * 1024 }));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (!result.stdout.includes(digest)) throw new Error(`Full-output SHA256 mismatch for ${name}`);
  const output = bytes.toString("utf8");
  append(`FULL OUTPUT BEGIN (${bytes.length} bytes; sha256=${digest})\n`);
  append(output);
  append(`\nFULL OUTPUT END\nEXIT: ${result.exitCode}\n`);
  const summaries = output.split(/\r?\n/).filter(line => summaryPattern.test(line));
  append(`SUMMARY LINES:\n${summaries.length ? summaries.join("\n") : "No test summary emitted in this stage."}\n`);
  console.log(`REMOTE ${name} EXIT=${result.exitCode}; FULL_OUTPUT_BYTES=${bytes.length}`);
  console.log(summaries.join("\n") || "No test summary emitted in this stage.");
  if (result.stderr) append(`TRANSPORT STDERR:\n${result.stderr}\n`);
  if (result.exitCode !== 0) failed = true;
  return result.exitCode;
}
try {
  const machines = await client.listMachines();
  append(`MACHINES: ${machines.map(m => `${m.alias}:${m.state}`).join(", ")}\n`);
  const selected = ["mengmotaMac", "gorky"].map(alias => machines.find(m => m.alias === alias && m.state === "online")).find(Boolean);
  if (!selected) throw new Error("Neither mengmotaMac nor gorky is online");
  machine = await client.getMachine(selected.alias);
  append(`MACHINE: ${selected.alias} ${selected.os}/${selected.arch}\n`);
  console.log(`MACHINE: ${selected.alias}`);
  const reserve = await machine.shell(`mkdir ${quote(remoteRoot)} && mkdir ${quote(`${remoteRoot}/logs`)} ${quote(`${remoteRoot}/tmp`)}`, { timeoutMs: 30_000 });
  append(`REMOTE DIR RESERVATION EXIT: ${reserve.exitCode}\n${reserve.stdout}${reserve.stderr}\n`);
  if (reserve.exitCode !== 0) throw new Error("Remote directory already exists or cannot be reserved; not deleting an unowned directory");
  owned = true;
  const cloneExit = await stage("clone", `git clone --branch lcx/astra-default-models --depth 1 ${quote(origin)} ${quote(remoteRepo)}`, remoteRoot);
  if (cloneExit !== 0) throw new Error("Clone failed; no checkout available for gates");
  const head = await machine.shell(`cd ${quote(remoteRepo)} && git rev-parse HEAD && bun --version && node --version`, { timeoutMs: 30_000 });
  append(`REMOTE HEAD AND TOOLCHAIN:\n${head.stdout}${head.stderr}\n`);
  const remoteHead = head.stdout.trim().split(/\r?\n/)[0];
  if (head.exitCode !== 0 || remoteHead !== expectedHead) throw new Error(`Remote HEAD did not match pushed HEAD: ${remoteHead}`);
  console.log(`REMOTE HEAD: ${remoteHead}`);
  await stage("frozen-install", "bun install --frozen-lockfile", remoteRepo);
  await stage("scoped-unit-gate", "bun test packages/rules-engine packages/omo-codex/plugin/components/rules packages/omo-codex/src/install packages/omo-codex/scripts packages/omo-codex/plugin/test script/codex-install-bundle-freshness.test.ts", remoteRepo);
  await stage("codex-gate", "bun run test:codex", remoteRepo);
} catch (error) {
  failed = true;
  const message = error instanceof Error ? error.stack : String(error);
  append(`\nDRIVER ERROR:\n${message}\n`);
  console.error(message);
} finally {
  try {
    if (owned) {
      const cleanup = await machine.shell(`rm -rf ${quote(remoteRoot)} && if [ ! -e ${quote(remoteRoot)} ]; then printf 'dir REMOVED: %s\\n' ${quote(remoteRoot)}; else printf 'dir REMOVAL FAILED\\n'; exit 1; fi`, { timeoutMs: 120_000 });
      append(`\nCLEANUP EXIT: ${cleanup.exitCode}\n${cleanup.stdout}${cleanup.stderr}\n`);
      console.log(cleanup.stdout.trim());
      if (cleanup.exitCode !== 0) failed = true;
    }
  } catch (error) {
    failed = true;
    append(`\nCLEANUP ERROR: ${String(error)}\n`);
    console.error(error);
  } finally {
    await client.close();
    const command = "tsgo --noEmit -p packages/omo-codex/tsconfig.json";
    const check = spawnSync("tsgo", ["--noEmit", "-p", "packages/omo-codex/tsconfig.json"], { cwd: root, encoding: "utf8", timeout: 300_000 });
    append(`\n===== LOCAL TYPECHECK =====\nCOMMAND: ${command}\n${check.stdout ?? ""}${check.stderr ?? ""}\nEXIT: ${check.status}\n${check.error ? `ERROR: ${check.error.message}\n` : ""}`);
    console.log(`LOCAL ${command}: EXIT=${check.status}`);
    if (check.status !== 0) failed = true;
    append(`\nOVERALL: ${failed ? "FAIL" : "PASS"}\n`);
    console.log(`EVIDENCE: ${logPath}`);
    process.exitCode = failed ? 1 : 0;
  }
}
