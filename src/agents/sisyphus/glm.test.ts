/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test";
import { buildGlmSisyphusPrompt } from "./glm";
import { buildKimiK26SisyphusPrompt } from "./kimi-k2-6";

const MODEL = "z-ai/glm-5";

function buildEmptyGlmPrompt(useTaskSystem = false): string {
  return buildGlmSisyphusPrompt(MODEL, [], [], [], [], useTaskSystem);
}

describe("buildGlmSisyphusPrompt - Small_Context_Working_Memory block", () => {
  test("#given empty inputs #then prompt contains exactly one Small_Context_Working_Memory block", () => {
    // given / when
    const prompt = buildEmptyGlmPrompt();

    // then
    const openCount = prompt.split("<Small_Context_Working_Memory>").length - 1;
    const closeCount =
      prompt.split("</Small_Context_Working_Memory>").length - 1;
    expect(openCount).toBe(1);
    expect(closeCount).toBe(1);
  });

  test("#given empty inputs #then prompt anchors slices under .sisyphus/state/{plan-or-session}/", () => {
    // given / when
    const prompt = buildEmptyGlmPrompt();

    // then
    expect(prompt).toContain(".sisyphus/state/{plan-or-session}/");
  });

  test("#given empty inputs #then prompt declares all five state slice file names", () => {
    // given / when
    const prompt = buildEmptyGlmPrompt();

    // then
    expect(prompt).toContain("goal.md");
    expect(prompt).toContain("decisions.md");
    expect(prompt).toContain("files.md");
    expect(prompt).toContain("blockers.md");
    expect(prompt).toContain("verification.md");
  });

  test("#given empty inputs #then prompt encodes the 500-token soft slice target", () => {
    // given / when
    const prompt = buildEmptyGlmPrompt();

    // then
    expect(prompt).toContain("500");
  });

  test("#given empty inputs #then prompt caps slice reads at 4 per turn", () => {
    // given / when
    const prompt = buildEmptyGlmPrompt();

    // then
    expect(prompt).toMatch(/AT MOST 4 slices/);
  });

  test("#given empty inputs #then prompt requires relevant-slice-only reads", () => {
    // given / when
    const prompt = buildEmptyGlmPrompt();

    // then
    expect(prompt.toLowerCase()).toContain("relevant-slice-only");
  });

  test("#given empty inputs #then prompt explains that missing slices mean first run", () => {
    // given / when
    const prompt = buildEmptyGlmPrompt();

    // then
    expect(prompt.toLowerCase()).toContain("first run");
  });
});

describe("buildGlmSisyphusPrompt - divergence from Kimi prompt", () => {
  test("#given empty inputs #then GLM prompt does not mention Toggle RL", () => {
    // given / when
    const prompt = buildEmptyGlmPrompt();

    // then
    expect(prompt).not.toContain("Toggle RL");
  });

  test("#given identical empty inputs #then GLM prompt is shorter than the Kimi prompt", () => {
    // given
    const glmPrompt = buildGlmSisyphusPrompt(MODEL, [], [], [], [], false);
    const kimiPrompt = buildKimiK26SisyphusPrompt(MODEL, [], [], [], [], false);

    // then
    expect(glmPrompt.length).toBeLessThan(kimiPrompt.length);
  });

  test("#given empty inputs with task system enabled #then GLM prompt is still shorter than Kimi prompt", () => {
    // given
    const glmPrompt = buildGlmSisyphusPrompt(MODEL, [], [], [], [], true);
    const kimiPrompt = buildKimiK26SisyphusPrompt(MODEL, [], [], [], [], true);

    // then
    expect(glmPrompt.length).toBeLessThan(kimiPrompt.length);
  });
});
