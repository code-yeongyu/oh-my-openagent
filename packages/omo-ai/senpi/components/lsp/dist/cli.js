#!/usr/bin/env node

import { argv, stdin, stderr } from "node:process";
import { recordComponentHookMarker } from "../../_shared/hook-marker.mjs";

const MUTATION_TOOL_NAMES = new Set([
  "apply_patch",
  "bash",
  "edit",
  "multi_edit",
  "multiedit",
  "write",
]);

async function main() {
  const args = argv.slice(2);
  recordComponentHookMarker("lsp", args);

  const [command = "mcp", subcommand = ""] = args;
  if (command === "hook" && subcommand === "post-tool-use") {
    await runPostToolUseHook();
    return;
  }

  if (command === "hook") {
    return;
  }

  if (command === "mcp") {
    return;
  }

  stderr.write("Usage: omo-lsp [mcp | hook post-tool-use]\n");
  process.exitCode = 2;
}

async function runPostToolUseHook() {
  const diagnosticsText = process.env["OMO_AI_LSP_DIAGNOSTICS_TEXT"];
  if (diagnosticsText === undefined || diagnosticsText.trim().length === 0) {
    return;
  }

  const input = await readHookInput();
  if (input === null) {
    const reason =
      "Invalid LSP hook input: malformed PostToolUse JSON on stdin. Blocking because LSP diagnostics are available but the edited file path could not be trusted.";
    const output = {
      decision: "block",
      reason,
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: reason,
      },
    };

    process.stdout.write(`${JSON.stringify(output)}\n`);
    return;
  }

  const filePaths = extractEditedFilePaths(input);
  if (filePaths.length === 0) {
    return;
  }

  const reason = filePaths
    .map((filePath) => `LSP diagnostics after editing ${filePath}:\n\n${diagnosticsText}`)
    .join("\n\n");
  const output = {
    decision: "block",
    reason,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: reason,
    },
  };

  process.stdout.write(`${JSON.stringify(output)}\n`);
}

async function readHookInput() {
  const raw = await readStdin();
  if (raw.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function readStdin() {
  stdin.setEncoding("utf8");
  let raw = "";
  for await (const chunk of stdin) {
    raw += chunk;
  }
  return raw;
}

function extractEditedFilePaths(input) {
  const toolName = stringValue(input["tool_name"] ?? input["toolName"]).toLowerCase();
  if (!MUTATION_TOOL_NAMES.has(toolName) && !toolResponseLooksLikeEdit(input["tool_response"] ?? input["toolResponse"])) {
    return [];
  }

  const paths = new Set();
  const toolInput = recordValue(input["tool_input"] ?? input["toolInput"]);
  collectPathFields(paths, toolInput);
  collectPatchPaths(paths, toolInput["command"]);
  collectPatchPaths(paths, toolInput["input"]);
  collectPatchPaths(paths, toolInput["patch"]);
  collectToolResponsePaths(paths, input["tool_response"] ?? input["toolResponse"]);
  return [...paths];
}

function collectToolResponsePaths(paths, value) {
  if (typeof value === "string") {
    collectPatchPaths(paths, value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectToolResponsePaths(paths, item);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  collectPathFields(paths, value);
  for (const [key, item] of Object.entries(value)) {
    if (key === "content" || key === "output" || key === "stdout" || key === "text") {
      collectPatchPaths(paths, item);
      continue;
    }
    if (key === "files" || key === "changes") {
      collectToolResponsePaths(paths, item);
    }
  }
}

function collectPathFields(paths, value) {
  if (!isRecord(value)) {
    return;
  }

  addPath(paths, value["file_path"]);
  addPath(paths, value["filePath"]);
  addPath(paths, value["path"]);
  addPathArray(paths, value["file_paths"]);
  addPathArray(paths, value["filePaths"]);
  addPathArray(paths, value["paths"]);
  collectToolResponsePaths(paths, value["files"]);
  collectToolResponsePaths(paths, value["changes"]);
}

function collectPatchPaths(paths, value) {
  if (typeof value !== "string") {
    return;
  }

  for (const line of value.split("\n")) {
    const trimmedLine = line.trim();
    for (const prefix of ["*** Add File: ", "*** Update File: ", "*** Delete File: ", "*** Move to: "]) {
      if (trimmedLine.startsWith(prefix)) {
        addPath(paths, trimmedLine.slice(prefix.length).trim());
      }
    }
  }
}

function toolResponseLooksLikeEdit(value) {
  if (typeof value === "string") {
    return value.includes("*** Begin Patch") || value.includes("*** Update File:") || value.includes("*** Add File:");
  }
  if (Array.isArray(value)) {
    return value.some(toolResponseLooksLikeEdit);
  }
  if (!isRecord(value)) {
    return false;
  }
  return ["file_path", "filePath", "path", "files", "changes", "content", "output", "stdout", "text"].some(
    (key) => key in value && toolResponseLooksLikeEditValue(value[key]),
  );
}

function toolResponseLooksLikeEditValue(value) {
  if (typeof value === "string") {
    return value.length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return isRecord(value);
}

function addPath(paths, value) {
  if (typeof value === "string" && value.length > 0) {
    paths.add(value);
  }
}

function addPathArray(paths, value) {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    addPath(paths, item);
  }
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function recordValue(value) {
  return isRecord(value) ? value : {};
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main().catch((error) => {
  stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
