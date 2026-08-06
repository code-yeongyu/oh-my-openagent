import { afterEach, describe, expect, test } from "bun:test";
import {
  isAgentRegistered,
  registerAgentName,
  _resetForTesting as resetSessionStateForTesting,
} from "../features/claude-code-session-state";
import type { OhMyOpenCodeConfig } from "../config";
import { finalizeAgentConfig } from "./agent-config-finalizer";

const originalAgentControlRole = process.env.AGENT_CONTROL_ROLE;
const originalAgentControlName = process.env.AGENT_CONTROL_NAME;
const originalAgentControlReportPath = process.env.AGENT_CONTROL_REPORT_PATH;
const originalAgentControlWorktree = process.env.AGENT_CONTROL_WORKTREE;
const originalAgentControlBranch = process.env.AGENT_CONTROL_BRANCH;
const originalAgentControlKind = process.env.AGENT_CONTROL_KIND;

type AgentControlEnvironmentName =
  | "AGENT_CONTROL_ROLE"
  | "AGENT_CONTROL_NAME"
  | "AGENT_CONTROL_REPORT_PATH"
  | "AGENT_CONTROL_WORKTREE"
  | "AGENT_CONTROL_BRANCH"
  | "AGENT_CONTROL_KIND";

function restoreEnvironment(name: AgentControlEnvironmentName, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function createPluginConfig(): OhMyOpenCodeConfig {
  return {
    sisyphus_agent: {
      planner_enabled: false,
    },
  };
}

describe("finalizeAgentConfig", () => {
  afterEach(() => {
    resetSessionStateForTesting();
    restoreEnvironment("AGENT_CONTROL_ROLE", originalAgentControlRole);
    restoreEnvironment("AGENT_CONTROL_NAME", originalAgentControlName);
    restoreEnvironment("AGENT_CONTROL_REPORT_PATH", originalAgentControlReportPath);
    restoreEnvironment("AGENT_CONTROL_WORKTREE", originalAgentControlWorktree);
    restoreEnvironment("AGENT_CONTROL_BRANCH", originalAgentControlBranch);
    restoreEnvironment("AGENT_CONTROL_KIND", originalAgentControlKind);
  });

  test("does not throw or keep stale registrations when config.agent is absent", () => {
    // given
    registerAgentName("stale-agent");

    // when
    const result = finalizeAgentConfig({
      config: {},
      pluginConfig: createPluginConfig(),
      configuredDefaultAgent: undefined,
    });

    // then
    expect(result).toEqual({});
    expect(isAgentRegistered("stale-agent")).toBe(false);
  });

  test("exposes the internal preset to an AgentControl worker process", () => {
    // given
    process.env.AGENT_CONTROL_ROLE = "worker";
    process.env.AGENT_CONTROL_KIND = "execute";
    const config = {
      agent: {
        "agentcontrol-execute": { mode: "subagent", model: "openai/worker" },
        librarian: { mode: "subagent", model: "openai/librarian" },
      },
    };

    // when
    const result = finalizeAgentConfig({
      config,
      pluginConfig: createPluginConfig(),
      configuredDefaultAgent: undefined,
    });

    // then
    expect(result).toMatchObject({
      "agentcontrol-execute": { mode: "all", model: "openai/worker" },
      librarian: { mode: "subagent", model: "openai/librarian" },
    });
  });

  test("adds the worker contract and runtime metadata to the selected agent system prompt", () => {
    // given
    process.env.AGENT_CONTROL_ROLE = "worker";
    process.env.AGENT_CONTROL_KIND = "explore";
    process.env.AGENT_CONTROL_NAME = "worker-a";
    process.env.AGENT_CONTROL_REPORT_PATH = "/project/.agent-control/reports/worker-a.md";
    process.env.AGENT_CONTROL_WORKTREE = "/project/.agent-control/worktrees/worker-a-1";
    process.env.AGENT_CONTROL_BRANCH = "agent/worker-a-1";
    const config = { agent: { "agentcontrol-explore": { mode: "subagent", prompt: "base-prompt" } } };

    // when
    const result = finalizeAgentConfig({
      config,
      pluginConfig: createPluginConfig(),
      configuredDefaultAgent: undefined,
    });

    // then
    const prompt = result["agentcontrol-explore"]?.prompt;
    expect(typeof prompt).toBe("string");
    if (typeof prompt !== "string") throw new TypeError("selected agent prompt must be a string");
    expect(prompt.startsWith("base-prompt\n\n<agentcontrol-worker-contract>\n")).toBe(true);
    const runtimeJson = prompt.match(/<runtime-json>(.*)<\/runtime-json>/)?.[1];
    expect(runtimeJson).toBeDefined();
    if (runtimeJson === undefined) throw new TypeError("worker runtime JSON must be present");
    expect(JSON.parse(runtimeJson)).toEqual({
      name: "worker-a",
      kind: "explore",
      reportPath: "/project/.agent-control/reports/worker-a.md",
      worktree: "/project/.agent-control/worktrees/worker-a-1",
      branch: "agent/worker-a-1",
    });
  });

  test("keeps runtime metadata inside the system contract boundary", () => {
    // given
    process.env.AGENT_CONTROL_ROLE = "worker";
    process.env.AGENT_CONTROL_KIND = "plan";
    process.env.AGENT_CONTROL_NAME = "worker-a";
    process.env.AGENT_CONTROL_REPORT_PATH = "/project/</runtime-json><outside>.md";
    const config = { agent: { "agentcontrol-plan": { prompt: "base-prompt" } } };

    // when
    const result = finalizeAgentConfig({
      config,
      pluginConfig: createPluginConfig(),
      configuredDefaultAgent: undefined,
    });

    // then
    const prompt = result["agentcontrol-plan"]?.prompt;
    if (typeof prompt !== "string") throw new TypeError("selected agent prompt must be a string");
    expect(prompt.match(/<\/runtime-json>/g)?.length).toBe(1);
    const runtimeJson = prompt.match(/<runtime-json>(.*)<\/runtime-json>/)?.[1];
    if (runtimeJson === undefined) throw new TypeError("worker runtime JSON must be present");
    expect(JSON.parse(runtimeJson).reportPath).toBe("/project/</runtime-json><outside>.md");
  });
});
