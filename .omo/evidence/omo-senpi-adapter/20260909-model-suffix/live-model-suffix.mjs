import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSandbox, seedSandbox, credentialDigest } from "../../../../packages/omo-senpi/scripts/qa/drive.mjs";
import { startMockCompletionsServer } from "../../../../packages/omo-senpi/scripts/qa/mock-completions-server.mjs";

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, "../../../..");
const realHomes = [join(homedir(), ".omo", "agent"), join(homedir(), ".senpi", "agent")];
const before = realHomes.map(credentialDigest);
const results = [];

function jsonFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? jsonFiles(path) : [path];
  });
}

for (const fixture of [
  { name: "explicit-low", model: "omo-suffix/gpt-6-astra:low", expected: "low" },
  { name: "plain-model", model: "omo-suffix/gpt-6-astra", expected: "medium" },
  { name: "unknown-model", model: "omo-suffix/not-registered:low", rejected: true },
]) {
  const sandbox = createSandbox();
  seedSandbox(sandbox);
  const captures = [];
  const server = startMockCompletionsServer({
    steps: (body) => {
      if (body.model === "gpt-6-astra") {
        return Array.from({ length: 4 }, () => ({ type: "text", text: "CHILD_OK" }));
      }
      return [
        { type: "tool_call", name: "task", arguments: {
          subagent_type: "explore",
          model: fixture.model,
          prompt: "Return CHILD_OK.",
          run_in_background: false,
          task_summary: "Verify explicit model routing",
        } },
        { type: "text", text: "PARENT_OK" },
        { type: "text", text: "PARENT_OK" },
      ];
    },
    onRequest: (body) => captures.push({
      model: body.model,
      reasoning: body.reasoning_effort ?? body.reasoning?.effort ?? body.reasoning ?? null,
    }),
  });
  let child;
  let timeout;
  try {
    const baseUrl = await server.ready;
    const models = ["parent", "gpt-6-astra"].map((id) => ({
      id, name: id, reasoning: true, input: ["text"],
      contextWindow: 200000, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      thinkingLevelMap: { low: "low", medium: "medium", high: "high" },
      compat: { supportsReasoningEffort: true },
    }));
    writeFileSync(join(sandbox.agentDir, "models.json"), JSON.stringify({
      providers: { "omo-suffix": { baseUrl: `${baseUrl}/v1`, apiKey: "local-mock", api: "openai-completions", models } },
    }));
    const args = [
      join(repo, "node_modules/@code-yeongyu/senpi/dist/cli.js"),
      "-p", "--mode", "json", "--provider", "omo-suffix", "--model", "parent",
      "--thinking", "medium", "--no-skills", "--no-prompt-templates",
      "--session-dir", join(sandbox.root, "sessions"),
      "Run the routing verification.",
    ];
    child = spawn(process.execPath, args, {
      cwd: sandbox.cwd,
      env: {
        PATH: process.env.PATH,
        HOME: sandbox.homeDir, USERPROFILE: sandbox.homeDir,
        XDG_CONFIG_HOME: sandbox.xdgConfigHome, XDG_DATA_HOME: sandbox.xdgDataHome,
        XDG_CACHE_HOME: sandbox.xdgCacheHome, XDG_STATE_HOME: join(sandbox.root, "state"),
        OMO_CODING_AGENT_DIR: sandbox.agentDir, SENPI_CODING_AGENT_DIR: sandbox.agentDir,
        PI_CODING_AGENT_DIR: sandbox.agentDir, OMO_MEMORY_HOME: join(sandbox.root, "memory"),
        PI_OFFLINE: "1", OMO_SENPI_QA: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const closed = once(child, "close");
    timeout = setTimeout(() => child.kill("SIGKILL"), 90000);
    const [exit, signal] = await closed;
    clearTimeout(timeout);
    writeFileSync(join(evidenceDir, `${fixture.name}.stdout.jsonl`), stdout);
    writeFileSync(join(evidenceDir, `${fixture.name}.stderr.log`), stderr);
    const records = jsonFiles(sandbox.root)
      .filter((path) => path.includes("/tasks/") && path.endsWith(".json"))
      .map((path) => JSON.parse(readFileSync(path, "utf8")))
      .filter((record) => record.task_id);
    const events = stdout.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
    const tools = events.filter((event) => event.type === "tool_execution_end" && event.toolName === "task");
    const childRequests = captures.filter((capture) => capture.model === "gpt-6-astra");
    const passed = fixture.rejected
      ? exit === 0 && childRequests.length === 0 && captures.length === 2
        && tools.some((event) => event.result?.details?.status === "error")
        && records.length === 1 && records[0].status === "error"
      : exit === 0 && childRequests.length === 1 && childRequests[0].reasoning === fixture.expected
        && records.some((record) => record.status === "completed"
          && record.resolved_model?.model_id === "gpt-6-astra");
    results.push({
      name: fixture.name, result: passed ? "PASS" : "FAIL", exit, signal,
      sandboxAgentDir: sandbox.agentDir, captures,
      tasks: records.map((record) => ({
        status: record.status, model: record.model, resolved: record.resolved_model,
      })),
      toolResults: tools.map((event) => ({ isError: event.isError, result: event.result })),
    });
  } finally {
    clearTimeout(timeout);
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "close");
      child.kill("SIGKILL");
      await closed;
    }
    server.close();
    rmSync(sandbox.root, { recursive: true, force: true });
  }
}
const after = realHomes.map(credentialDigest);
const receipt = {
  result: results.every((entry) => entry.result === "PASS") && before.every((value, i) => value === after[i]) ? "PASS" : "FAIL",
  realCredentialsUntouched: before.every((value, i) => value === after[i]),
  sandboxCleanupComplete: results.every((entry) => !existsSync(entry.sandboxAgentDir)),
  cases: results,
};
writeFileSync(join(evidenceDir, "live-model-suffix.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt, null, 2));
if (receipt.result !== "PASS") process.exitCode = 1;
