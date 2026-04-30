/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test";
import { buildGlmWorkingMemory, buildGlmVisionConstraint } from "./glm";

describe("buildGlmWorkingMemory", () => {
  test("#given call #then contains exactly one Small_Context_Working_Memory block", () => {
    // given
    const block = buildGlmWorkingMemory();

    // then
    const openCount = block.split("<Small_Context_Working_Memory>").length - 1;
    const closeCount =
      block.split("</Small_Context_Working_Memory>").length - 1;
    expect(openCount).toBe(1);
    expect(closeCount).toBe(1);
  });

  test("#given call #then anchors slices under .sisyphus/state/{plan-or-session}/", () => {
    // given
    const block = buildGlmWorkingMemory();

    // then
    expect(block).toContain(".sisyphus/state/{plan-or-session}/");
  });

  test("#given call #then declares all five state slice file names", () => {
    // given
    const block = buildGlmWorkingMemory();

    // then
    expect(block).toContain("goal.md");
    expect(block).toContain("decisions.md");
    expect(block).toContain("files.md");
    expect(block).toContain("blockers.md");
    expect(block).toContain("verification.md");
  });

  test("#given call #then encodes the 500-token soft slice target", () => {
    // given
    const block = buildGlmWorkingMemory();

    // then
    expect(block).toContain("500");
  });

  test("#given call #then caps slice reads at 4 per turn", () => {
    // given
    const block = buildGlmWorkingMemory();

    // then
    expect(block).toMatch(/AT MOST 4 slices/);
  });

  test("#given call #then requires relevant-slice-only reads", () => {
    // given
    const block = buildGlmWorkingMemory();

    // then
    expect(block.toLowerCase()).toContain("relevant-slice-only");
  });

  test("#given call #then explains that missing slices mean first run", () => {
    // given
    const block = buildGlmWorkingMemory();

    // then
    expect(block.toLowerCase()).toContain("first run");
  });
});

describe("buildGlmVisionConstraint", () => {
  test("#given call #then contains GLM_VISION_CONSTRAINT tag", () => {
    // given
    const block = buildGlmVisionConstraint();

    // then
    expect(block).toContain("<GLM_VISION_CONSTRAINT>");
    expect(block).toContain("</GLM_VISION_CONSTRAINT>");
  });

  test("#given call #then mentions text-only limitation", () => {
    // given
    const block = buildGlmVisionConstraint();

    // then
    expect(block).toContain("text-only");
    expect(block).toContain("multimodal-looker");
  });
});
