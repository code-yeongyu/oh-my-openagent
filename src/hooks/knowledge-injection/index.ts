import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeEntry } from "../../shared/knowledge-extractor";

export interface KnowledgeInjectionConfig {
  storagePath?: string;
}

const DEFAULT_STORAGE_PATH = ".opencode/knowledge.json";

export function createKnowledgeInjectionHook(config?: KnowledgeInjectionConfig) {
  const storagePath = config?.storagePath ?? DEFAULT_STORAGE_PATH;

  const loadKnowledge = (): KnowledgeEntry[] => {
    if (!existsSync(storagePath)) {
      return [];
    }
    try {
      const content = readFileSync(storagePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return [];
    }
  };

  return {
    "tool.execute.before": async (
      _input: { tool: string; sessionID: string; callID: string },
      _output: { args: Record<string, unknown> }
    ): Promise<void> => {
      const knowledge = loadKnowledge();
      
      if (knowledge.length === 0) {
        return;
      }

      // Knowledge is loaded and available for injection
      // Future: Match patterns against tool context and inject relevant solutions
    },
  };
}
