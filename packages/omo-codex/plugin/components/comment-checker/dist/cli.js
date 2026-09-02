#!/usr/bin/env node

// components/comment-checker/src/codex-hook.ts
import { readFileSync } from "node:fs";
import { stdin as processStdin, stdout as processStdout } from "node:process";

// ../../utils/src/record-type-guard.ts
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

// ../../comment-checker-core/src/apply-patch-edits.ts
function extractApplyPatchEdits(details, args) {
  const metadataEdits = getApplyPatchMetadataFiles(details).filter((file) => file.type?.toLowerCase() !== "delete").map((file) => ({
    filePath: file.movePath ?? file.filePath,
    before: file.before,
    after: file.after
  }));
  if (metadataEdits.length > 0)
    return metadataEdits;
  const patch = args === undefined ? undefined : getString(args, ["patchText", "input", "patch", "command"]);
  if (patch === undefined)
    return [];
  return parseApplyPatchRequests(patch);
}
function getApplyPatchMetadataFiles(details) {
  if (!isRecord(details))
    return [];
  const direct = readApplyPatchMetadataFiles(details["files"]);
  if (direct.length > 0)
    return direct;
  const resultDetails = details["result"];
  const result = isRecord(resultDetails) ? readApplyPatchMetadataFiles(resultDetails["files"]) : [];
  if (result.length > 0)
    return result;
  const metadataDetails = details["metadata"];
  return isRecord(metadataDetails) ? readApplyPatchMetadataFiles(metadataDetails["files"]) : [];
}
function readApplyPatchMetadataFiles(value) {
  if (!Array.isArray(value))
    return [];
  const files = [];
  for (const item of value) {
    if (!isRecord(item))
      continue;
    const filePath = getString(item, ["filePath", "file_path", "path"]);
    const movePath = getString(item, ["movePath", "move_path"]);
    const before = getString(item, ["before", "old", "oldString", "old_string"]);
    const after = getString(item, ["after", "new", "newString", "new_string"]);
    const type = getString(item, ["type", "operation"]);
    if (filePath === undefined || before === undefined || after === undefined)
      continue;
    files.push({
      filePath,
      before,
      after,
      ...movePath === undefined ? {} : { movePath },
      ...type === undefined ? {} : { type }
    });
  }
  return files;
}
function parseApplyPatchRequests(patch) {
  const edits = [];
  let current;
  const flush = () => {
    if (current === undefined)
      return;
    if (current.operation === "add") {
      const after = joinPatchLines(current.newLines);
      if (after.length > 0) {
        edits.push({ filePath: current.filePath, before: "", after });
      }
    }
    if (current.operation === "update") {
      const after = joinPatchLines(current.newLines);
      if (after.length > 0) {
        edits.push({
          filePath: current.movePath ?? current.filePath,
          before: joinPatchLines(current.oldLines),
          after
        });
      }
    }
    current = undefined;
  };
  for (const line of patch.split(/\r?\n/)) {
    if (line === "*** Begin Patch" || line === "*** End Patch")
      continue;
    if (line.startsWith("*** Add File: ")) {
      flush();
      current = makeAccumulator("add", line.slice("*** Add File: ".length).trim());
      continue;
    }
    if (line.startsWith("*** Update File: ")) {
      flush();
      current = makeAccumulator("update", line.slice("*** Update File: ".length).trim());
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      flush();
      current = makeAccumulator("delete", line.slice("*** Delete File: ".length).trim());
      continue;
    }
    if (line.startsWith("*** Move to: ")) {
      if (current?.operation === "update") {
        current.movePath = line.slice("*** Move to: ".length).trim();
      }
      continue;
    }
    if (current === undefined || line.startsWith("@@"))
      continue;
    if (current.operation === "add") {
      if (line.startsWith("+"))
        current.newLines.push(line.slice(1));
      continue;
    }
    if (current.operation === "update") {
      if (line.startsWith("-"))
        current.oldLines.push(line.slice(1));
      if (line.startsWith("+"))
        current.newLines.push(line.slice(1));
    }
  }
  flush();
  return edits;
}
function makeAccumulator(operation, filePath) {
  return {
    operation,
    filePath,
    oldLines: [],
    newLines: []
  };
}
function getString(input, keys) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string")
      return value;
  }
  return;
}
function joinPatchLines(lines) {
  return lines.length === 0 ? "" : `${lines.join(`
`)}
`;
}
// components/comment-checker/src/hook-input.ts
function toHookInput(request, context) {
  return {
    session_id: context.sessionId,
    tool_name: request.toolName,
    transcript_path: context.transcriptPath ?? "",
    cwd: context.cwd,
    hook_event_name: "PostToolUse",
    tool_input: request.toolInput
  };
}
// components/comment-checker/src/apply-patch.ts
function extractApplyPatchRequests(event) {
  const metadataRequests = extractApplyPatchMetadataRequests(event.details, event.toolName);
  if (metadataRequests.length > 0)
    return metadataRequests;
  return toCommentCheckRequests(extractApplyPatchEdits(undefined, event.input), event.toolName);
}
function extractApplyPatchMetadataRequests(details, sourceToolName) {
  const edits = getApplyPatchMetadataFiles(details).filter((file) => file.filePath.length > 0 && file.type !== "delete").map((file) => ({
    filePath: file.movePath ?? file.filePath,
    before: file.before,
    after: file.after
  }));
  return toCommentCheckRequests(edits, sourceToolName);
}
function toCommentCheckRequests(edits, sourceToolName) {
  const requests = [];
  for (const edit of edits) {
    if (edit.before.length === 0) {
      requests.push({
        sourceToolName,
        toolName: "Write",
        filePath: edit.filePath,
        toolInput: {
          file_path: edit.filePath,
          content: edit.after
        }
      });
      continue;
    }
    requests.push({
      sourceToolName,
      toolName: "Edit",
      filePath: edit.filePath,
      toolInput: {
        file_path: edit.filePath,
        old_string: edit.before,
        new_string: edit.after
      }
    });
  }
  return requests;
}

// components/comment-checker/src/request-extractor.ts
function extractCommentCheckRequests(event) {
  if (event.isError)
    return [];
  if (isToolFailureOutput(getContentText(event.content)))
    return [];
  const toolName = event.toolName.toLowerCase();
  if (toolName === "write")
    return extractWriteRequest(event);
  if (toolName === "edit")
    return extractEditRequest(event);
  if (toolName === "multiedit" || toolName === "multi_edit")
    return extractMultiEditRequest(event);
  if (toolName === "apply_patch")
    return extractApplyPatchRequests(event);
  return [];
}
function isToolFailureOutput(text) {
  const lower = text.trim().toLowerCase();
  return lower.startsWith("error") || lower.includes("error:") || lower.includes("failed to") || lower.includes("could not");
}
function extractWriteRequest(event) {
  const filePath = getString(event.input, ["filePath", "file_path", "path"]);
  const content = getString(event.input, ["content"]);
  if (!filePath || content === undefined)
    return [];
  return [
    {
      sourceToolName: event.toolName,
      toolName: "Write",
      filePath,
      toolInput: {
        file_path: filePath,
        content
      }
    }
  ];
}
function extractEditRequest(event) {
  const filePath = getString(event.input, ["filePath", "file_path", "path"]);
  const oldString = getString(event.input, ["oldString", "old_string"]);
  const newString = getString(event.input, ["newString", "new_string"]);
  if (!filePath || oldString === undefined || newString === undefined)
    return [];
  return [
    {
      sourceToolName: event.toolName,
      toolName: "Edit",
      filePath,
      toolInput: {
        file_path: filePath,
        old_string: oldString,
        new_string: newString
      }
    }
  ];
}
function extractMultiEditRequest(event) {
  const filePath = getString(event.input, ["filePath", "file_path", "path"]);
  const edits = getEdits(event.input["edits"]);
  if (!filePath || edits.length === 0)
    return [];
  return [
    {
      sourceToolName: event.toolName,
      toolName: "MultiEdit",
      filePath,
      toolInput: {
        file_path: filePath,
        edits
      }
    }
  ];
}
function getEdits(value) {
  if (!Array.isArray(value))
    return [];
  const edits = [];
  for (const item of value) {
    if (!isRecord(item))
      continue;
    const oldString = getString(item, ["oldString", "old_string"]);
    const newString = getString(item, ["newString", "new_string"]);
    if (oldString === undefined || newString === undefined)
      continue;
    edits.push({
      old_string: oldString,
      new_string: newString
    });
  }
  return edits;
}
function getContentText(content) {
  if (!content)
    return "";
  return content.filter((block) => block.type === "text").map((block) => block.text).join(`
`);
}
// components/comment-checker/src/runner.ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
var MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
async function runCommentChecker2(input, options = {}) {
  const binaryPath = options.binaryPath ?? (options.resolveBinary ? options.resolveBinary() : resolveCommentCheckerBinary2());
  if (!binaryPath) {
    return {
      status: "missing",
      message: "comment-checker binary not found. Run npm install for the codex-comment-checker plugin."
    };
  }
  const args = ["check"];
  if (options.customPrompt) {
    args.push("--prompt", options.customPrompt);
  }
  const executor = options.executor ?? spawnProcess;
  const result = await executor(binaryPath, args, JSON.stringify(input));
  const message = result.stderr || result.stdout;
  if (result.exitCode === 0) {
    return {
      status: "pass",
      message: "",
      binaryPath,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr
    };
  }
  if (result.exitCode === 2) {
    return {
      status: "warning",
      message,
      binaryPath,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr
    };
  }
  return {
    status: "error",
    message,
    binaryPath,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr
  };
}
function resolveCommentCheckerBinary2() {
  const binaryName = process.platform === "win32" ? "comment-checker.exe" : "comment-checker";
  const fromPackageApi = resolvePackageApiBinary();
  if (fromPackageApi)
    return fromPackageApi;
  const fromPackage = resolvePackageBinary(binaryName);
  if (fromPackage)
    return fromPackage;
  return;
}
function resolvePackageApiBinary() {
  try {
    const require2 = createRequire(import.meta.url);
    const packageExports = require2(commentCheckerPackageName());
    if (!isCommentCheckerPackage(packageExports))
      return;
    const binaryPath = packageExports.getBinaryPath();
    return existsSync(binaryPath) ? binaryPath : undefined;
  } catch {
    return;
  }
}
function resolvePackageBinary(binaryName) {
  try {
    const require2 = createRequire(import.meta.url);
    const packagePath = require2.resolve(`${commentCheckerPackageName()}/package.json`);
    const binaryPath = join(dirname(packagePath), "bin", binaryName);
    return existsSync(binaryPath) ? binaryPath : undefined;
  } catch {
    return;
  }
}
function commentCheckerPackageName() {
  return ["@code-yeongyu", "comment-checker"].join("/");
}
function isCommentCheckerPackage(value) {
  return isRecord2(value) && typeof value["getBinaryPath"] === "function";
}
function isRecord2(value) {
  return typeof value === "object" && value !== null;
}
function appendOutput(output, chunk, maxOutputBytes) {
  if (output.truncated)
    return;
  const remainingBytes = maxOutputBytes - output.bytes;
  const chunkBytes = Buffer.byteLength(chunk, "utf8");
  if (chunkBytes <= remainingBytes) {
    output.text += chunk;
    output.bytes += chunkBytes;
    return;
  }
  if (remainingBytes > 0) {
    output.text += Buffer.from(chunk, "utf8").subarray(0, remainingBytes).toString("utf8");
    output.bytes += remainingBytes;
  }
  output.truncated = true;
}
function formatOutput(output, streamName, maxOutputBytes) {
  if (!output.truncated)
    return output.text;
  return `${output.text}
[${streamName} truncated after ${maxOutputBytes} bytes]`;
}
function spawnProcess(command, args, stdin, maxOutputBytes = MAX_PROCESS_OUTPUT_BYTES) {
  return new Promise((resolve) => {
    const outputByteLimit = Number.isFinite(maxOutputBytes) && maxOutputBytes > 0 ? Math.floor(maxOutputBytes) : 0;
    const proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const stdout = { text: "", bytes: 0, truncated: false };
    const stderr = { text: "", bytes: 0, truncated: false };
    proc.stdout.setEncoding("utf-8");
    proc.stderr.setEncoding("utf-8");
    proc.stdout.on("data", (chunk) => {
      appendOutput(stdout, chunk, outputByteLimit);
    });
    proc.stderr.on("data", (chunk) => {
      appendOutput(stderr, chunk, outputByteLimit);
    });
    proc.once("error", (error) => {
      appendOutput(stderr, error.message, outputByteLimit);
      resolve({
        exitCode: null,
        stdout: formatOutput(stdout, "stdout", outputByteLimit),
        stderr: formatOutput(stderr, "stderr", outputByteLimit)
      });
    });
    proc.once("close", (exitCode) => {
      resolve({
        exitCode,
        stdout: formatOutput(stdout, "stdout", outputByteLimit),
        stderr: formatOutput(stderr, "stderr", outputByteLimit)
      });
    });
    proc.stdin.end(stdin);
  });
}

// components/comment-checker/src/codex-hook.ts
var DEFAULT_MAX_HOOK_FEEDBACK_CHARS = 8000;
var CONTEXT_PRESSURE_MAX_HOOK_FEEDBACK_CHARS = 1200;
var CONTEXT_PRESSURE_MARKERS = [
  "context compacted",
  "context_length_exceeded",
  "skill descriptions were shortened",
  "context_too_large",
  "codex ran out of room in the model's context window",
  "your input exceeds the context window",
  "long threads and multiple compactions"
];
function extractCodexCommentCheckRequests(input) {
  return extractCommentCheckRequests(toToolResultLike(input));
}
async function runCommentCheckerPostToolUse(input, options = {}) {
  const requests = extractCodexCommentCheckRequests(input);
  if (requests.length === 0)
    return "";
  const runner = options.run ?? runCommentChecker2;
  const warnings = [];
  for (const request of requests) {
    const context = {
      sessionId: input.session_id,
      cwd: input.cwd,
      ...input.transcript_path === null ? {} : { transcriptPath: input.transcript_path }
    };
    const result = await runner(toHookInput(request, context));
    if (result.status === "missing" || result.status === "pass")
      continue;
    if (result.status === "error")
      continue;
    const message = normalizeHookText(result.message);
    if (message.length > 0) {
      warnings.push({ filePath: request.filePath, message });
    }
  }
  if (warnings.length === 0)
    return "";
  return JSON.stringify({
    decision: "block",
    reason: limitHookText(formatWarnings(warnings), hookFeedbackLimit(input.transcript_path))
  });
}
async function runCodexHookCli() {
  const input = await readStdin();
  if (input.trim().length === 0)
    return;
  const parsed = parseCodexPostToolUseInput(input);
  if (!parsed)
    return;
  const output = await runCommentCheckerPostToolUse(parsed);
  if (output.length > 0) {
    processStdout.write(output);
    processStdout.write(`
`);
  }
}
function parseCodexPostToolUseInput(input) {
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    return;
  }
  return isCodexPostToolUseInput(parsed) ? parsed : undefined;
}
function toToolResultLike(input) {
  return {
    toolName: input.tool_name,
    input: normalizeToolInput(input.tool_name, input.tool_input),
    content: normalizeToolResponse(input.tool_response),
    isError: isErrorResponse(input.tool_response),
    details: isRecord(input.tool_response) ? input.tool_response : undefined
  };
}
function normalizeToolInput(toolName, toolInput) {
  if (toolName === "apply_patch" && typeof toolInput["command"] === "string") {
    return {
      ...toolInput,
      input: toolInput["command"],
      patch: toolInput["command"]
    };
  }
  return toolInput;
}
function normalizeToolResponse(toolResponse) {
  if (typeof toolResponse === "string") {
    return [{ type: "text", text: toolResponse }];
  }
  if (isRecord(toolResponse) && typeof toolResponse["text"] === "string") {
    return [{ type: "text", text: toolResponse["text"] }];
  }
  return [];
}
function isErrorResponse(toolResponse) {
  return isRecord(toolResponse) && toolResponse["is_error"] === true;
}
function formatWarnings(warnings) {
  return warnings.map((warning) => `comment-checker found issues in ${warning.filePath}:
${warning.message}`).join(`

`);
}
function normalizeHookText(value) {
  return value.replace(/\r\n/g, `
`).replace(/\r/g, `
`).trim();
}
function hookFeedbackLimit(transcriptPath) {
  return isContextPressureTranscript(transcriptPath) ? CONTEXT_PRESSURE_MAX_HOOK_FEEDBACK_CHARS : DEFAULT_MAX_HOOK_FEEDBACK_CHARS;
}
function isContextPressureTranscript(transcriptPath) {
  if (transcriptPath === null)
    return false;
  try {
    return hasContextPressureMarker(readFileSync(transcriptPath, "utf8"));
  } catch (error) {
    if (error instanceof Error)
      return false;
    throw error;
  }
}
function hasContextPressureMarker(text) {
  const normalizedText = text.toLowerCase();
  return CONTEXT_PRESSURE_MARKERS.some((marker) => normalizedText.includes(marker));
}
function limitHookText(text, maxChars) {
  if (text.length <= maxChars)
    return text;
  const marker = `

[Truncated hook output to ${maxChars} chars to avoid Codex context overflow.]`;
  if (marker.length >= maxChars)
    return marker.slice(0, maxChars);
  const head = text.slice(0, maxChars - marker.length).replace(/[ \t\r\n]+$/, "");
  return `${head}${marker}`;
}
function isCodexPostToolUseInput(value) {
  return isRecord(value) && value["hook_event_name"] === "PostToolUse" && typeof value["session_id"] === "string" && typeof value["turn_id"] === "string" && (typeof value["transcript_path"] === "string" || value["transcript_path"] === null) && typeof value["cwd"] === "string" && typeof value["model"] === "string" && typeof value["permission_mode"] === "string" && typeof value["tool_name"] === "string" && isRecord(value["tool_input"]) && typeof value["tool_use_id"] === "string";
}
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    processStdin.setEncoding("utf-8");
    processStdin.on("data", (chunk) => {
      data += chunk;
    });
    processStdin.once("error", reject);
    processStdin.once("end", () => {
      resolve(data);
    });
  });
}

// components/comment-checker/src/cli.ts
var [command, subcommand] = process.argv.slice(2);
if (command === "hook" && subcommand === "post-tool-use") {
  await runCodexHookCli();
} else {
  process.stderr.write(`Usage: omo-comment-checker hook post-tool-use
`);
  process.exitCode = 2;
}
