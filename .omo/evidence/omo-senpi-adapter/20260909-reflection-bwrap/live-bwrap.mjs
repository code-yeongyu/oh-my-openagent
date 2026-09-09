import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSandboxTransform } from "../../../../packages/omo-senpi/src/components/memory/sandbox.ts";
import { credentialDigest, seedSandbox } from "../../../../packages/omo-senpi/scripts/qa/drive.mjs";
import { startMockCompletionsServer } from "../../../../packages/omo-senpi/scripts/qa/mock-completions-server.mjs";

const evidence = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidence, "../../../..");
const root = mkdtempSync(join(evidence, "sandbox-"));
const sandbox = {
  root, cwd: join(root, "project"), agentDir: join(root, "agent"),
  homeDir: join(root, "home"), xdgConfigHome: join(root, "config"),
  xdgDataHome: join(root, "data"), xdgCacheHome: join(root, "cache"),
};
seedSandbox(sandbox);
const realHomes = [join(homedir(), ".omo", "agent"), join(homedir(), ".senpi", "agent")];
const before = realHomes.map(credentialDigest);
const sessionDir = join(root, "runtime", "reflection-sessions");
const nestedDir = join(root, "runtime", "reflection", "runs");
const gitDir = join(root, "git");
mkdirSync(gitDir);
const guardPath = join(root, "ungranted.txt");
writeFileSync(guardPath, "unchanged");
const probePath = join(sessionDir, "probe.txt");
const requests = [];
const server = startMockCompletionsServer({
  steps: [
    { type: "tool_call", name: "bash", arguments: {
      command: `printf sandbox-write-ok > ${JSON.stringify(probePath)}; if printf forbidden > ${JSON.stringify(guardPath)}; then exit 7; fi`,
    } },
    { type: "text", text: "BWRAP_CHILD_OK" },
  ],
  onRequest: (body) => requests.push({ model: body.model, reasoning: body.reasoning_effort ?? null }),
});
let child;
let timer;
let receipt;
try {
  const baseUrl = await server.ready;
  writeFileSync(join(sandbox.agentDir, "models.json"), JSON.stringify({
    providers: { "bwrap-fixture": {
      baseUrl: `${baseUrl}/v1`, apiKey: "local-only", api: "openai-completions",
      models: [{
        id: "fixture", name: "Bwrap fixture", reasoning: true,
        thinkingLevelMap: { low: "low", medium: "medium", high: "high" },
        compat: { supportsReasoningEffort: true },
        input: ["text"], contextWindow: 200000, maxTokens: 2048,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }],
    } },
  }));
  const env = {
    PATH: process.env.PATH, HOME: sandbox.homeDir, USERPROFILE: sandbox.homeDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome, XDG_DATA_HOME: sandbox.xdgDataHome,
    XDG_CACHE_HOME: sandbox.xdgCacheHome, XDG_STATE_HOME: join(sandbox.homeDir, "state"),
    OMO_CODING_AGENT_DIR: sandbox.agentDir, SENPI_CODING_AGENT_DIR: sandbox.agentDir,
    PI_CODING_AGENT_DIR: sandbox.agentDir, PI_OFFLINE: "1", SENPI_PTY_FORCE_PIPE: "1",
  };
  const command = Bun.which("node");
  if (!command) throw new Error("Node CLI is unavailable");
  const absentBefore = !existsSync(sessionDir) && !existsSync(nestedDir);
  const transform = buildSandboxTransform({
    policy: "required", worktreeDir: sandbox.cwd, gitCommonDir: gitDir,
    payloadPaths: [], runtimeWrites: [
      sessionDir, nestedDir, sandbox.agentDir, sandbox.homeDir,
      sandbox.xdgConfigHome, sandbox.xdgDataHome, sandbox.xdgCacheHome,
    ],
    command, env,
  });
  const spec = transform({
    command, args: [
      join(repo, "node_modules/@code-yeongyu/senpi/dist/cli.js"),
      "-p", "--mode", "json", "--no-extensions", "--no-skills",
      "--no-prompt-templates", "--no-context-files", "--tools", "bash,edit",
      "--provider", "bwrap-fixture", "--model", "fixture", "--thinking", "low",
      "--session-dir", sessionDir, "Perform the sandbox write probe.",
    ],
    cwd: sandbox.cwd, env, detached: true, attempt: 1,
    hardDeadlineAt: Date.now() + 90000, category: "memory-reflection",
    conversationIds: ["isolated-fixture"], model: "bwrap-fixture/fixture",
    paths: { sessionDir, worktree: sandbox.cwd, gitCommonDir: gitDir,
      transcript: join(nestedDir, "transcript.json"), persona: join(nestedDir, "persona.md"),
      prompt: join(nestedDir, "prompt.md") },
  });
  child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const closed = once(child, "close");
  timer = setTimeout(() => child.kill("SIGKILL"), 90000);
  const [exit, signal] = await closed;
  clearTimeout(timer);
  const wroteGranted = existsSync(probePath) && readFileSync(probePath, "utf8") === "sandbox-write-ok";
  const outsideUnchanged = readFileSync(guardPath, "utf8") === "unchanged";
  receipt = {
    result: exit === 0 && absentBefore && transform.wasSandboxed && wroteGranted
      && outsideUnchanged && requests.length === 2 ? "PASS" : "FAIL",
    absentBefore, wasSandboxed: transform.wasSandboxed, exit, signal,
    sessionDirectoryMode: existsSync(sessionDir) ? (statSync(sessionDir).mode & 0o777).toString(8) : null,
    nestedDirectoryMode: existsSync(nestedDir) ? (statSync(nestedDir).mode & 0o777).toString(8) : null,
    wroteGranted, outsideUnchanged, requests, sandboxAgentDir: sandbox.agentDir,
    realCredentialsUntouched: before.every((value, i) => value === credentialDigest(realHomes[i])),
  };
  writeFileSync(join(evidence, "live-bwrap.stdout.jsonl"), stdout);
  writeFileSync(join(evidence, "live-bwrap.stderr.log"), stderr);
} finally {
  clearTimeout(timer);
  if (child && child.exitCode === null && child.signalCode === null) {
    const closed = once(child, "close");
    child.kill("SIGKILL");
    await closed;
  }
  server.close();
  rmSync(root, { recursive: true, force: true });
}
receipt.sandboxCleanupComplete = !existsSync(root);
writeFileSync(join(evidence, "live-bwrap.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt, null, 2));
if (receipt.result !== "PASS" || !receipt.realCredentialsUntouched) process.exitCode = 1;
