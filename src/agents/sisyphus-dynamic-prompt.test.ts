import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type {
  AvailableAgent,
  AvailableCategory,
  AvailableSkill,
  AvailableTool,
} from "./dynamic-agent-prompt-builder";
import { buildFallbackSisyphusPrompt } from "./sisyphus-dynamic-prompt";

const representativeAgents: AvailableAgent[] = [
  {
    name: "explore",
    description: "Codebase search specialist",
    metadata: {
      category: "exploration",
      cost: "CHEAP",
      triggers: [{ domain: "Codebase search", trigger: "Find existing code patterns" }],
      keyTrigger: "Codebase question -> fire explore",
    },
  },
  {
    name: "librarian",
    description: "External docs researcher",
    metadata: {
      category: "exploration",
      cost: "CHEAP",
      triggers: [{ domain: "External docs", trigger: "Research library behavior" }],
      keyTrigger: "External library mentioned -> fire librarian",
    },
  },
  {
    name: "oracle",
    description: "Read-only architecture consultant",
    metadata: {
      category: "advisor",
      cost: "EXPENSIVE",
      triggers: [{ domain: "Architecture", trigger: "Evaluate risky design choices" }],
      promptAlias: "Oracle",
    },
  },
];

const representativeTools: AvailableTool[] = [
  { name: "read", category: "other" },
  { name: "grep", category: "search" },
  { name: "task", category: "other" },
];

const representativeSkills: AvailableSkill[] = [
  {
    name: "debugging",
    description: "Runtime debugging workflow",
    location: "plugin",
  },
  {
    name: "frontend-ui-ux",
    description: "Frontend visual polish",
    location: "user",
  },
];

const representativeCategories: AvailableCategory[] = [
  {
    name: "deep",
    description: "Autonomous implementation and verification",
  },
  {
    name: "quick",
    description: "Small focused tasks",
  },
];

function representativePromptFor(model: string): string {
  return buildFallbackSisyphusPrompt(
    model,
    representativeAgents,
    representativeTools,
    representativeSkills,
    representativeCategories,
    true,
  );
}

function expectPromptFingerprint(prompt: string, expectedHash: string, expectedLength: number): void {
  expect(createHash("sha256").update(prompt).digest("hex")).toBe(expectedHash);
  expect(prompt.length).toBe(expectedLength);
}

function expectInOrder(prompt: string, orderedAnchors: readonly string[]): void {
  let previousIndex = -1;

  for (const anchor of orderedAnchors) {
    const currentIndex = prompt.indexOf(anchor);
    expect(currentIndex).toBeGreaterThan(previousIndex);
    previousIndex = currentIndex;
  }
}

describe("buildFallbackSisyphusPrompt", () => {
  describe("#given a representative non-Gemini fallback model", () => {
    test("#when building the prompt #then preserves the exact generated text and section order", () => {
      // given
      const model = "anthropic/claude-sonnet-4-6";

      // when
      const prompt = representativePromptFor(model);

      // then
      expectPromptFingerprint(
        prompt,
        "8de80c5029bca5d376e87ad94504cfbe2cb3bb9c2a6af687007eb1470b0effed",
        27888,
      );
      expectInOrder(prompt, [
        "<Role>",
        "<Behavior_Instructions>",
        "## Phase 0 - Intent Gate (EVERY message)",
        "<intent_verbalization>",
        "### Step 1: Classify Request Type",
        "## Phase 2A - Exploration & Research",
        "<tool_usage_rules>",
        "## Phase 2B - Implementation",
        "<Constraints>",
      ]);
    });
  });

  describe("#given a representative Gemini fallback model", () => {
    test("#when building the prompt #then preserves exact Gemini override placement", () => {
      // given
      const model = "google/gemini-3.1-pro";

      // when
      const prompt = representativePromptFor(model);

      // then
      expectPromptFingerprint(
        prompt,
        "55b4802d15cb14a2532a93b01fd81176e781ac92a02295eef38c9511253108c0",
        40387,
      );
      expectInOrder(prompt, [
        "<intent_verbalization>",
        "</intent_verbalization>",
        "<GEMINI_INTENT_GATE_ENFORCEMENT>",
        "<TOOL_CALL_MANDATE>",
        "<tool_usage_rules>",
        "</tool_usage_rules>",
        "<GEMINI_TOOL_GUIDE>",
        "<GEMINI_TOOL_CALL_EXAMPLES>",
        "<GEMINI_DELEGATION_OVERRIDE>",
        "<GEMINI_VERIFICATION_OVERRIDE>",
        "<Constraints>",
      ]);
    });
  });
});
