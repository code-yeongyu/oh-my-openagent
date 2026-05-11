import type { PluginInput } from "@opencode-ai/plugin";
import { promises as fsPromises } from "node:fs";
import { dirname } from "node:path";

import type { createDynamicTruncator } from "../../shared/dynamic-truncator";
import { findAgentsMdUp, resolveFilePath } from "./finder";
import { loadInjectedPaths, saveInjectedPaths } from "./storage";

type DynamicTruncator = ReturnType<typeof createDynamicTruncator>;

const ADDITIONAL_INSTRUCTIONS_MARKER = "Additional project instructions matched for ";
const DIRECTORY_CONTEXT_MARKER = "[Directory Context: ";
const INSTRUCTIONS_FROM_MARKER = "Instructions from: ";

interface InstructionBlock {
  path: string;
  start: number;
  end: number;
  source: "directory-context" | "instructions-from";
}

function lineStartAt(output: string, index: number): number {
  const previousNewline = output.lastIndexOf("\n", index - 1);
  return previousNewline === -1 ? 0 : previousNewline + 1;
}

function lineEndAt(output: string, index: number): number {
  const nextNewline = output.indexOf("\n", index);
  return nextNewline === -1 ? output.length : nextNewline;
}

function findAdditionalInstructionsBlockStart(output: string, instructionsLineStart: number): number {
  const headerStart = output.lastIndexOf(ADDITIONAL_INSTRUCTIONS_MARKER, instructionsLineStart);
  if (headerStart === -1) return instructionsLineStart;

  const headerLineEnd = lineEndAt(output, headerStart);
  if (headerLineEnd > instructionsLineStart) return instructionsLineStart;

  const gap = output.slice(headerLineEnd, instructionsLineStart);
  return gap.trim() === "" ? headerStart : instructionsLineStart;
}

function findNextInstructionBlockStart(output: string, from: number): number {
  const markers = [
    `\n\n${ADDITIONAL_INSTRUCTIONS_MARKER}`,
    `\n\n${DIRECTORY_CONTEXT_MARKER}`,
    `\n\n${INSTRUCTIONS_FROM_MARKER}`,
  ];
  const starts = markers
    .map((marker) => output.indexOf(marker, from))
    .filter((index) => index !== -1);
  return starts.length > 0 ? Math.min(...starts) : output.length;
}

function collectInstructionBlocks(output: string): InstructionBlock[] {
  const blocks: InstructionBlock[] = [];

  let searchIndex = 0;
  while (true) {
    const markerIndex = output.indexOf(INSTRUCTIONS_FROM_MARKER, searchIndex);
    if (markerIndex === -1) break;

    const lineStart = lineStartAt(output, markerIndex);
    const lineEnd = lineEndAt(output, markerIndex);
    const instructionPath = output.slice(markerIndex + INSTRUCTIONS_FROM_MARKER.length, lineEnd).trim();
    if (instructionPath) {
      blocks.push({
        path: instructionPath,
        start: findAdditionalInstructionsBlockStart(output, lineStart),
        end: findNextInstructionBlockStart(output, lineEnd),
        source: "instructions-from",
      });
    }
    searchIndex = lineEnd;
  }

  searchIndex = 0;
  while (true) {
    const markerIndex = output.indexOf(DIRECTORY_CONTEXT_MARKER, searchIndex);
    if (markerIndex === -1) break;

    const pathStart = markerIndex + DIRECTORY_CONTEXT_MARKER.length;
    const pathEnd = output.indexOf("]", pathStart);
    if (pathEnd === -1) break;

    const instructionPath = output.slice(pathStart, pathEnd).trim();
    if (instructionPath) {
      blocks.push({
        path: instructionPath,
        start: lineStartAt(output, markerIndex),
        end: findNextInstructionBlockStart(output, pathEnd),
        source: "directory-context",
      });
    }
    searchIndex = pathEnd + 1;
  }

  return blocks.sort((a, b) => a.start - b.start);
}

function removeInstructionBlockRanges(
  output: string,
  ranges: Array<{ start: number; end: number }>,
): string {
  let deduped = output;
  for (const range of [...ranges].sort((a, b) => b.start - a.start)) {
    deduped = deduped.slice(0, range.start) + deduped.slice(range.end);
  }
  return deduped.replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "");
}

function dedupeExistingInstructionBlocks(
  output: string,
  cache: Set<string>,
): { output: string; dirty: boolean } {
  const blocks = collectInstructionBlocks(output);
  if (blocks.length === 0) return { output, dirty: false };

  const seenInOutput = new Set<string>();
  const rangesToRemove: Array<{ start: number; end: number }> = [];
  let dirty = false;

  for (const block of blocks) {
    const repeatedNativeInstruction = block.source === "instructions-from" && cache.has(block.path);
    if (repeatedNativeInstruction || seenInOutput.has(block.path)) {
      rangesToRemove.push({ start: block.start, end: block.end });
      dirty = true;
      continue;
    }

    cache.add(block.path);
    seenInOutput.add(block.path);
    dirty = true;
  }

  return {
    output: rangesToRemove.length > 0 ? removeInstructionBlockRanges(output, rangesToRemove) : output,
    dirty,
  };
}

function getSessionCache(
  sessionCaches: Map<string, Set<string>>,
  sessionID: string,
): Set<string> {
  if (!sessionCaches.has(sessionID)) {
    sessionCaches.set(sessionID, loadInjectedPaths(sessionID));
  }
  return sessionCaches.get(sessionID)!;
}

export async function processFilePathForAgentsInjection(input: {
  ctx: PluginInput;
  truncator: DynamicTruncator;
  sessionCaches: Map<string, Set<string>>;
  filePath: string;
  sessionID: string;
  output: { title: string; output: string; metadata: unknown };
}): Promise<void> {
  // Guard: output.output may be non-string at runtime (e.g. MCP bridge format changes).
  // Consistent with the pattern used in tool-output-truncator and other hooks.
  if (typeof input.output.output !== "string") return;

  const resolved = resolveFilePath(input.ctx.directory, input.filePath);
  if (!resolved) return;

  const dir = dirname(resolved);
  const cache = getSessionCache(input.sessionCaches, input.sessionID);
  const agentsPaths = await findAgentsMdUp({ startDir: dir, rootDir: input.ctx.directory });
  const dedupedExisting = dedupeExistingInstructionBlocks(input.output.output, cache);
  input.output.output = dedupedExisting.output;

  let dirty = dedupedExisting.dirty;
  for (const agentsPath of agentsPaths) {
    const agentsDir = dirname(agentsPath);
    if (cache.has(agentsPath) || cache.has(agentsDir)) continue;

    try {
      const content = await fsPromises.readFile(agentsPath, "utf-8");
      cache.add(agentsPath);
      const { result, truncated } = await input.truncator.truncate(
        input.sessionID,
        content,
      );
      const truncationNotice = truncated
        ? `\n\n[Note: Content was truncated to save context window space. For full context, please read the file directly: ${agentsPath}]`
        : "";
      input.output.output += `\n\n[Directory Context: ${agentsPath}]\n${result}${truncationNotice}`;
      dirty = true;
    } catch {}
  }

  if (dirty) {
    saveInjectedPaths(input.sessionID, cache);
  }
}
