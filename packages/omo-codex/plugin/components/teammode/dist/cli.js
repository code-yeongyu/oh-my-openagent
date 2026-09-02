#!/usr/bin/env node

// components/teammode/src/codex-hook.ts
var CREATE_THREAD_TOOL_NAMES = new Set(["create_thread", "codex_app.create_thread"]);
function parsePostToolUsePayload(raw) {
  if (raw.trim().length === 0)
    return null;
  try {
    const parsed = JSON.parse(raw);
    return isPostToolUsePayload(parsed) ? parsed : null;
  } catch (error) {
    if (error instanceof SyntaxError)
      return null;
    return null;
  }
}
function runPostToolUseHook(payload) {
  if (payload.hook_event_name !== "PostToolUse")
    return "";
  if (!CREATE_THREAD_TOOL_NAMES.has(payload.tool_name))
    return "";
  const threadReference = extractThreadCreationReference(payload.tool_response);
  if (threadReference === null)
    return "";
  const output = {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: threadTitleReminder(threadReference)
    }
  };
  return `${JSON.stringify(output)}
`;
}
async function runTeammodeHookCli(stdin, stdout) {
  const payload = parsePostToolUsePayload(await readAll(stdin));
  if (payload === null)
    return;
  const output = runPostToolUseHook(payload);
  if (output.length > 0)
    stdout.write(output);
}
function threadTitleReminder(threadReference) {
  const id = formatIdentifier(threadReference.id);
  return threadReference.kind === "thread" ? `THREAD ID ${id}: CALL codex_app.set_thread_title NOW. USE THE REAL TASK/ROLE.` : `PENDING WORKTREE ID ${id}: WORKTREE THREAD IS NOT READY YET. DO NOT bind-thread OR SEND THE MEMBER BOOTSTRAP UNTIL A REAL THREAD ID EXISTS. THEN CALL codex_app.set_thread_title USING THE REAL TASK/ROLE.`;
}
function formatIdentifier(value) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 200 ? normalized : `${normalized.slice(0, 197)}...`;
}
function extractThreadCreationReference(toolResponse) {
  const response = parseToolResponseRecord(toolResponse);
  if (response === null)
    return null;
  const threadId = response["threadId"];
  if (typeof threadId === "string" && threadId.trim().length > 0) {
    return { kind: "thread", id: threadId };
  }
  const pendingWorktreeId = response["pendingWorktreeId"];
  if (typeof pendingWorktreeId === "string" && pendingWorktreeId.trim().length > 0) {
    return { kind: "pendingWorktree", id: pendingWorktreeId };
  }
  return null;
}
function parseToolResponseRecord(toolResponse) {
  if (isRecord(toolResponse))
    return toolResponse;
  if (typeof toolResponse !== "string")
    return null;
  const trimmed = toolResponse.trim();
  if (trimmed.length === 0)
    return null;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch (error) {
    if (error instanceof SyntaxError)
      return null;
    return null;
  }
}
function isPostToolUsePayload(value) {
  if (!isRecord(value))
    return false;
  return value["hook_event_name"] === "PostToolUse" && typeof value["session_id"] === "string" && typeof value["tool_name"] === "string" && Object.hasOwn(value, "tool_input") && Object.hasOwn(value, "tool_response") && optionalString(value["turn_id"]) && optionalString(value["cwd"]) && optionalString(value["model"]) && optionalString(value["permission_mode"]) && optionalString(value["tool_use_id"]) && (value["transcript_path"] === undefined || value["transcript_path"] === null || typeof value["transcript_path"] === "string");
}
function optionalString(value) {
  return value === undefined || typeof value === "string";
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readAll(stdin) {
  return new Promise((resolve, reject) => {
    let data = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => {
      data += chunk instanceof Buffer ? chunk.toString() : String(chunk);
    });
    stdin.once("error", reject);
    stdin.once("end", () => resolve(data));
  });
}

// components/teammode/src/cli.ts
var [command, subcommand] = process.argv.slice(2);
if (command === "hook" && subcommand === "post-tool-use") {
  await runTeammodeHookCli(process.stdin, process.stdout);
} else {
  process.stderr.write(`Usage: omo-teammode hook post-tool-use
`);
  process.exitCode = 2;
}
