import type { PluginInput } from "@opencode-ai/plugin";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { relative, resolve } from "node:path";
import { findProjectRoot, findRuleFiles } from "./finder";
import {
  createContentHash,
  isDuplicateByContentHash,
  isDuplicateByRealPath,
  shouldApplyRule,
} from "./matcher";
import { parseRuleFrontmatter } from "./parser";
import {
  clearInjectedRules,
  loadInjectedRules,
  saveInjectedRules,
} from "./storage";
import { createDynamicTruncator } from "../../shared/dynamic-truncator";

interface ToolExecuteInput {
  tool: string;
  sessionID: string;
  callID: string;
}

interface ToolExecuteOutput {
  title: string;
  output: string;
  metadata: unknown;
}

interface ToolExecuteBeforeOutput {
  args: unknown;
}

interface BatchToolCall {
  tool: string;
  parameters: Record<string, unknown>;
}

interface EventInput {
  event: {
    type: string;
    properties?: unknown;
  };
}

interface RuleToInject {
  relativePath: string;
  matchReason: string;
  content: string;
  distance: number;
}

const TRACKED_TOOLS = ["read", "write", "edit", "multiedit"];

export function createRulesInjectorHook(ctx: PluginInput) {
  const sessionCaches = new Map<
    string,
    { contentHashes: Set<string>; realPaths: Set<string> }
  >();
  const pendingBatchFiles = new Map<string, string[]>();
  const truncator = createDynamicTruncator(ctx);

  function getSessionCache(sessionID: string): {
    contentHashes: Set<string>;
    realPaths: Set<string>;
  } {
    if (!sessionCaches.has(sessionID)) {
      sessionCaches.set(sessionID, loadInjectedRules(sessionID));
    }
    return sessionCaches.get(sessionID)!;
  }

  function resolveFilePath(path: string): string | null {
    if (!path) return null;
    if (path.startsWith("/")) return path;
    return resolve(ctx.directory, path);
  }

  async function processFilePathForInjection(
    filePath: string,
    sessionID: string,
    output: ToolExecuteOutput
  ): Promise<void> {
    const resolved = resolveFilePath(filePath);
    if (!resolved) return;

    const projectRoot = findProjectRoot(resolved);
    const cache = getSessionCache(sessionID);
    const home = homedir();

    const ruleFileCandidates = findRuleFiles(projectRoot, home, resolved);
    const toInject: RuleToInject[] = [];

    for (const candidate of ruleFileCandidates) {
      if (isDuplicateByRealPath(candidate.realPath, cache.realPaths)) continue;

      try {
        const rawContent = readFileSync(candidate.path, "utf-8");
        const { metadata, body } = parseRuleFrontmatter(rawContent);

        let matchReason: string;
        if (candidate.isSingleFile) {
          matchReason = "copilot-instructions (always apply)";
        } else {
          const matchResult = shouldApplyRule(metadata, resolved, projectRoot);
          if (!matchResult.applies) continue;
          matchReason = matchResult.reason ?? "matched";
        }

        const contentHash = createContentHash(body);
        if (isDuplicateByContentHash(contentHash, cache.contentHashes)) continue;

        const relativePath = projectRoot
          ? relative(projectRoot, candidate.path)
          : candidate.path;

        toInject.push({
          relativePath,
          matchReason,
          content: body,
          distance: candidate.distance,
        });

        cache.realPaths.add(candidate.realPath);
        cache.contentHashes.add(contentHash);
      } catch {}
    }

    if (toInject.length === 0) return;

    toInject.sort((a, b) => a.distance - b.distance);

    for (const rule of toInject) {
      const { result, truncated } = await truncator.truncate(sessionID, rule.content);
      const truncationNotice = truncated
        ? `\n\n[Note: Content was truncated to save context window space. For full context, please read the file directly: ${rule.relativePath}]`
        : "";
      output.output += `\n\n[Rule: ${rule.relativePath}]\n[Match: ${rule.matchReason}]\n${result}${truncationNotice}`;
    }

    saveInjectedRules(sessionID, cache);
  }

  function extractFilePathFromToolCall(call: BatchToolCall): string | null {
    const params = call.parameters;
    return (params?.filePath ?? params?.file_path ?? params?.path) as string | null;
  }

  const toolExecuteBefore = async (
    input: ToolExecuteInput,
    output: ToolExecuteBeforeOutput
  ) => {
    if (input.tool.toLowerCase() !== "batch") return;

    const args = output.args as { tool_calls?: BatchToolCall[] } | undefined;
    if (!args?.tool_calls) return;

    const filePaths: string[] = [];
    for (const call of args.tool_calls) {
      if (TRACKED_TOOLS.includes(call.tool.toLowerCase())) {
        const filePath = extractFilePathFromToolCall(call);
        if (filePath) {
          filePaths.push(filePath);
        }
      }
    }

    if (filePaths.length > 0) {
      pendingBatchFiles.set(input.callID, filePaths);
    }
  };

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput
  ) => {
    const toolName = input.tool.toLowerCase();

    if (TRACKED_TOOLS.includes(toolName)) {
      await processFilePathForInjection(output.title, input.sessionID, output);
      return;
    }

    if (toolName === "batch") {
      const filePaths = pendingBatchFiles.get(input.callID);
      if (filePaths) {
        for (const filePath of filePaths) {
          await processFilePathForInjection(filePath, input.sessionID, output);
        }
        pendingBatchFiles.delete(input.callID);
      }
    }
  };

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined;

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined;
      if (sessionInfo?.id) {
        sessionCaches.delete(sessionInfo.id);
        clearInjectedRules(sessionInfo.id);
      }
    }

    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined;
      if (sessionID) {
        sessionCaches.delete(sessionID);
        clearInjectedRules(sessionID);
      }
    }
  };

  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  };
}
