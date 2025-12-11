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

  function getSessionCache(sessionID: string): {
    contentHashes: Set<string>;
    realPaths: Set<string>;
  } {
    if (!sessionCaches.has(sessionID)) {
      sessionCaches.set(sessionID, loadInjectedRules(sessionID));
    }
    return sessionCaches.get(sessionID)!;
  }

  function resolveFilePath(title: string): string | null {
    if (!title) return null;
    if (title.startsWith("/")) return title;
    return resolve(ctx.directory, title);
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput
  ) => {
    if (!TRACKED_TOOLS.includes(input.tool.toLowerCase())) return;

    const filePath = resolveFilePath(output.title);
    if (!filePath) return;

    const projectRoot = findProjectRoot(filePath);
    const cache = getSessionCache(input.sessionID);
    const home = homedir();

    const ruleFileCandidates = findRuleFiles(projectRoot, home, filePath);
    const toInject: RuleToInject[] = [];

    for (const candidate of ruleFileCandidates) {
      if (isDuplicateByRealPath(candidate.realPath, cache.realPaths)) continue;

      try {
        const rawContent = readFileSync(candidate.path, "utf-8");
        const { metadata, body } = parseRuleFrontmatter(rawContent);

        const matchResult = shouldApplyRule(metadata, filePath, projectRoot);
        if (!matchResult.applies) continue;

        const contentHash = createContentHash(body);
        if (isDuplicateByContentHash(contentHash, cache.contentHashes)) continue;

        const relativePath = projectRoot
          ? relative(projectRoot, candidate.path)
          : candidate.path;

        toInject.push({
          relativePath,
          matchReason: matchResult.reason ?? "matched",
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
      output.output += `\n\n[Rule: ${rule.relativePath}]\n[Match: ${rule.matchReason}]\n${rule.content}`;
    }

    saveInjectedRules(input.sessionID, cache);
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
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  };
}
