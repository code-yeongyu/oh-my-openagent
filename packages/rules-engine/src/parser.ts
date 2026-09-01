import { parseFrontmatter, type RuleFrontmatterData } from "@oh-my-opencode/utils";
import type { RuleFrontmatterResult } from "./types";

export function parseRuleFrontmatter(content: string): RuleFrontmatterResult {
  const parsed = parseFrontmatter<RuleFrontmatterData>(content, { mode: "rule" });
  return { metadata: parsed.data, body: parsed.body };
}
