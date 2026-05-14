/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { buildGlmSisyphusPrompt } from "./sisyphus/glm";

describe("GLM prompt composer snapshot tests", () => {
  test("#given GLM model #when building prompt #then contains_re_entry_rule", () => {
    const prompt = buildGlmSisyphusPrompt("zai/glm-5.1", [], [], [], [], false);
    const reEntryRule =
      prompt.match(/<re_entry_rule>[\s\S]*?<\/re_entry_rule>/g)?.find((section) =>
        section.includes("CONFIRMATION turn"),
      ) ?? "";
    const numberedRules = reEntryRule.match(/^\s*\d+\./gm) ?? [];

    expect(reEntryRule).toContain("CONFIRMATION turn");
    expect(reEntryRule).toContain("EXPLICIT DECISION");
    expect(reEntryRule).toContain("INVALIDATE-ON-COMPACTION");
    expect(numberedRules.length).toBeGreaterThanOrEqual(4);
  });

  test("#given GLM model #when building prompt #then no_working_memory", () => {
    const prompt = buildGlmSisyphusPrompt("zai/glm-5.1", [], [], [], [], false);

    expect(prompt).not.toContain("context-memory.json");
    expect(prompt).not.toContain("Small_Context_Working_Memory");
    expect(prompt).not.toContain(".sisyphus/state/");
  });

  test("#given GLM model #when building prompt #then has_tiered_verification", () => {
    const prompt = buildGlmSisyphusPrompt("zai/glm-5.1", [], [], [], [], false);
    const verificationLoop = prompt.match(/<verification_loop>[\s\S]*?<\/verification_loop>/)?.[0] ?? "";

    expect(verificationLoop).toContain("V1");
    expect(verificationLoop).toContain("V2");
    expect(verificationLoop).toContain("V3");
  });

  test("#given GLM model #when building prompt #then has_5_exploration_stops", () => {
    const prompt = buildGlmSisyphusPrompt("zai/glm-5.1", [], [], [], [], false);
    const explorationBudget = prompt.match(/<exploration_budget>[\s\S]*?<\/exploration_budget>/)?.[0] ?? "";
    const stopConditions = explorationBudget.match(/^\s*\d+\./gm) ?? [];

    expect(explorationBudget).toContain("converged, STOP");
    expect(explorationBudget).toContain("re-derive");
    expect(stopConditions).toHaveLength(5);
  });

  test("#given GLM model #when building prompt #then has_dependency_checks", () => {
    const prompt = buildGlmSisyphusPrompt("zai/glm-5.1", [], [], [], [], false);

    expect(prompt).toContain("<dependency_checks>");
    expect(prompt).toContain("</dependency_checks>");
  });

  test("#given GLM model #when building prompt #then has_routing_table", () => {
    const prompt = buildGlmSisyphusPrompt("zai/glm-5.1", [], [], [], [], false);
    const executionLoop = prompt.match(/<execution_loop>[\s\S]*?<\/execution_loop>/)?.[0] ?? "";
    const routeSection = executionLoop.match(/3\. ROUTE[\s\S]*?4\. EXECUTE_OR_SUPERVISE/)?.[0] ?? "";

    expect(routeSection).toContain("delegate");
    expect(routeSection).toContain("self");
    expect(routeSection).toContain("answer");
    expect(routeSection).toContain("ask");
  });

  test("#given GLM model #when building prompt #then has_retry_logic", () => {
    const prompt = buildGlmSisyphusPrompt("zai/glm-5.1", [], [], [], [], false);
    const executionLoop = prompt.match(/<execution_loop>[\s\S]*?<\/execution_loop>/)?.[0] ?? "";
    const retrySection = executionLoop.match(/6\. RETRY[\s\S]*?7\. DONE/)?.[0] ?? "";

    expect(retrySection).toContain("3 attempts");
  });

  test("#given GLM model #when building prompt #then has_done_contract", () => {
    const prompt = buildGlmSisyphusPrompt("zai/glm-5.1", [], [], [], [], false);
    const executionLoop = prompt.match(/<execution_loop>[\s\S]*?<\/execution_loop>/)?.[0] ?? "";
    const doneSection = executionLoop.match(/7\. DONE[\s\S]*?<\/execution_loop>/)?.[0] ?? "";

    expect(doneSection).toContain("Every planned task");
  });

  test("#given GLM model #when building prompt #then has_post_delegation_verify", () => {
    const prompt = buildGlmSisyphusPrompt("zai/glm-5.1", [], [], [], [], false);
    const delegationBlock = prompt.match(/<delegation>[\s\S]*?<\/delegation>/)?.[0] ?? "";

    expect(delegationBlock).toMatch(
      /Self-reports are starting points, not proof|delegation never substitutes for verification/,
    );
  });

  test("#given GLM model #when building prompt #then no_shared_execution_loop_header", () => {
    const prompt = buildGlmSisyphusPrompt("zai/glm-5.1", [], [], [], [], false);

    expect(prompt).not.toContain("DISPATCH→DELEGATE→COLLECT→SYNTHESIZE");
  });

  test("#given GLM model #when building prompt #then token_budget_neutral", () => {
    const prompt = buildGlmSisyphusPrompt("zai/glm-5.1", [], [], [], [], false);

    expect(prompt.length).toBeGreaterThanOrEqual(10000);
    expect(prompt.length).toBeLessThanOrEqual(25000);
  });

  test("#given GLM model with useTaskSystem=true #when building prompt #then contains task marker not todo marker", () => {
    const prompt = buildGlmSisyphusPrompt("zai/glm-5.1", [], [], [], [], true);

    expect(prompt).toContain("TASK CREATION WOULD BE TRACKED");
    expect(prompt).not.toContain("TODO CREATION WOULD BE TRACKED");
  });

  test("#given GLM model with useTaskSystem=false #when building prompt #then contains todo marker not task marker", () => {
    const prompt = buildGlmSisyphusPrompt("zai/glm-5.1", [], [], [], [], false);

    expect(prompt).toContain("TODO CREATION WOULD BE TRACKED");
    expect(prompt).not.toContain("TASK CREATION WOULD BE TRACKED");
  });
});
