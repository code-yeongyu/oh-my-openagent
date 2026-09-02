#!/usr/bin/env node

// components/lazycodex-executor-verify/src/cli.ts
import { existsSync, mkdirSync, readFileSync as readFileSync2, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { stdin as processStdin, stdout as processStdout } from "node:process";

// components/lazycodex-executor-verify/src/codex-hook.ts
import { lstatSync as nodeLstatSync, realpathSync as nodeRealpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

// components/lazycodex-executor-verify/src/directive.ts
import { readFileSync } from "node:fs";
var LAZYCODEX_EXECUTOR_VERIFY_DIRECTIVE = readFileSync(new URL("../directive.md", import.meta.url), "utf8");
function renderDirective(attempts, lastAssistantMessage) {
  return LAZYCODEX_EXECUTOR_VERIFY_DIRECTIVE.replaceAll("{{ATTEMPT_COUNT}}", String(attempts)).replaceAll("{{LAST_ASSISTANT_MESSAGE}}", lastAssistantMessage ?? "(last_assistant_message was omitted)");
}

// components/lazycodex-executor-verify/src/state.ts
import { join } from "node:path";
var MAX_ATTEMPTS = 3;
function readAttemptState(cwd, sessionId, agentId, fs) {
  const statePath = getStatePath(cwd, sessionId, agentId);
  if (!fs.existsSync(statePath))
    return { attempts: 0 };
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (isAttemptState(parsed))
      return parsed;
    return { attempts: 0 };
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof Error)
      return { attempts: 0 };
    throw error;
  }
}
function writeAttemptState(cwd, sessionId, agentId, state, fs) {
  const stateDir = getStateDir(cwd);
  const statePath = getStatePath(cwd, sessionId, agentId);
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(tempPath, `${JSON.stringify(state)}
`);
  fs.renameSync(tempPath, statePath);
}
function clearAttemptState(cwd, sessionId, agentId, fs) {
  fs.rmSync(getStatePath(cwd, sessionId, agentId), { force: true });
}
function getStatePath(cwd, sessionId, agentId) {
  return join(getStateDir(cwd), `${sanitizeKey(sessionId)}-${sanitizeKey(agentId)}.json`);
}
function getStateDir(cwd) {
  return join(cwd, ".omo", "lazycodex-executor-verify");
}
function sanitizeKey(value) {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "missing";
}
function isAttemptState(value) {
  return isRecord(value) && typeof value["attempts"] === "number" && Number.isInteger(value["attempts"]);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// components/lazycodex-executor-verify/src/types.ts
var SUBAGENT_STOP_EVENT = "SubagentStop";

// components/lazycodex-executor-verify/src/codex-hook.ts
var RECEIPT_ENFORCED_AGENTS = new Set(["lazycodex-worker-low", "lazycodex-worker-medium", "lazycodex-worker-high"]);
function runSubagentStopHook(input, fs) {
  if (!isSubagentStopInput(input))
    return "";
  if (!RECEIPT_ENFORCED_AGENTS.has(input.agent_type))
    return "";
  if (transcriptHasContextPressureMarker(input.transcript_path, fs))
    return "";
  if (hasValidEvidenceReceipt(input, fs)) {
    clearAttemptState(input.cwd, input.session_id, input.agent_id, fs);
    return "";
  }
  const state = readAttemptState(input.cwd, input.session_id, input.agent_id, fs);
  if (state.attempts >= MAX_ATTEMPTS) {
    clearAttemptState(input.cwd, input.session_id, input.agent_id, fs);
    return "";
  }
  const attempts = state.attempts + 1;
  writeAttemptState(input.cwd, input.session_id, input.agent_id, { attempts }, fs);
  return JSON.stringify({
    decision: "block",
    reason: renderDirective(attempts, input.last_assistant_message)
  });
}
var CONTEXT_PRESSURE_MARKERS = [
  "context compacted",
  "context_length_exceeded",
  "skill descriptions were shortened",
  "context_too_large",
  "codex ran out of room in the model's context window",
  "your input exceeds the context window",
  "long threads and multiple compactions"
];
function transcriptHasContextPressureMarker(transcriptPath, fs) {
  try {
    const transcript = fs.readFileSync(transcriptPath, "utf8").toLowerCase();
    return CONTEXT_PRESSURE_MARKERS.some((marker) => transcript.includes(marker));
  } catch (error) {
    if (error instanceof Error)
      return false;
    throw error;
  }
}
function hasValidEvidenceReceipt(input, fs) {
  const receiptPath = extractEvidencePath(input.last_assistant_message);
  if (receiptPath === null)
    return false;
  const evidenceRoot = resolve(input.cwd, ".omo", "evidence");
  const resolvedPath = isAbsolute(receiptPath) ? resolve(receiptPath) : resolve(input.cwd, receiptPath);
  if (!isPathInsideDirectory(resolvedPath, evidenceRoot))
    return false;
  try {
    return isNonEmptyFileInsideEvidenceRoot(resolvedPath, evidenceRoot, input.cwd, fs);
  } catch (error) {
    if (error instanceof Error)
      return false;
    throw error;
  }
}
function isPathInsideDirectory(filePath, directoryPath) {
  const relativePath = relative(directoryPath, filePath);
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}
function isNonEmptyFileInsideEvidenceRoot(filePath, evidenceRoot, cwd, fs) {
  if (!fs.existsSync(filePath))
    return false;
  const realCwd = realPath(cwd, fs);
  const realEvidenceRoot = realPath(evidenceRoot, fs);
  const realFilePath = realPath(filePath, fs);
  if (!isPathInsideDirectory(realEvidenceRoot, realCwd))
    return false;
  if (!isPathInsideDirectory(realFilePath, realEvidenceRoot))
    return false;
  return isNonEmptyFile(filePath, fs);
}
function isNonEmptyFile(filePath, fs) {
  if (!fs.existsSync(filePath))
    return false;
  const linkStat = fs.lstatSync?.(filePath) ?? nodeLstatSync(filePath);
  if (linkStat.isSymbolicLink?.() === true)
    return false;
  const stat = fs.statSync(filePath);
  if (stat.size <= 0)
    return false;
  return stat.isFile?.() ?? true;
}
function realPath(path, fs) {
  return fs.realpathSync?.(path) ?? nodeRealpathSync(path);
}
function extractEvidencePath(message) {
  if (message === undefined)
    return null;
  const match = /EVIDENCE_RECORDED:\s*(\S+)/.exec(message);
  const receiptPath = match?.[1];
  return receiptPath === undefined ? null : receiptPath;
}
function isSubagentStopInput(value) {
  return isRecord2(value) && value["hook_event_name"] === SUBAGENT_STOP_EVENT && typeof value["agent_type"] === "string" && typeof value["agent_id"] === "string" && typeof value["session_id"] === "string" && typeof value["cwd"] === "string" && typeof value["transcript_path"] === "string" && typeof value["model"] === "string" && typeof value["permission_mode"] === "string" && typeof value["stop_hook_active"] === "boolean" && optionalString(value["turn_id"]) && optionalString(value["last_assistant_message"]);
}
function optionalString(value) {
  return value === undefined || typeof value === "string";
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// components/lazycodex-executor-verify/src/cli.ts
var nodeFileSystem = {
  existsSync,
  mkdirSync,
  readFileSync: readFileSync2,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
};
var command = process.argv[2];
var subcommand = process.argv[3];
if (command === "hook" && subcommand === "subagent-stop") {
  await runHookCli();
} else {
  process.stderr.write(`Usage: lazycodex-executor-verify hook subagent-stop
`);
  process.exitCode = 1;
}
async function runHookCli() {
  const raw = await readStdin();
  if (raw.trim().length === 0)
    return;
  const parsed = parseHookInput(raw);
  const output = runSubagentStopHook(parsed, nodeFileSystem);
  if (output.length > 0)
    processStdout.write(output);
}
function parseHookInput(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError)
      return;
    throw error;
  }
}
function readStdin() {
  return new Promise((resolve2) => {
    let data = "";
    processStdin.setEncoding("utf8");
    processStdin.on("data", (chunk) => {
      data += chunk;
    });
    processStdin.once("error", () => resolve2(data));
    processStdin.once("end", () => resolve2(data));
  });
}
