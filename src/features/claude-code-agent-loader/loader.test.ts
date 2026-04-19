import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  loadUserAgents,
  loadProjectAgents,
  loadOpencodeGlobalAgents,
  loadOpencodeProjectAgents,
} from "./loader";

/**
 * Creates a temporary directory tree for testing agent loading.
 * Returns the root dir with `.claude/agents/` and `.opencode/agents/` subdirs
 * pre-created, containing the specified agent files.
 */
function createProjectWithAgents(
  agents: {
    claudeAgents?: Array<{ filename: string; content: string }>;
    opencodeAgents?: Array<{ filename: string; content: string }>;
  } = {},
): string {
  const root = mkdtempSync(join(tmpdir(), "agent-loader-test-"));
  if (agents.claudeAgents) {
    const dir = join(root, ".claude", "agents");
    mkdirSync(dir, { recursive: true });
    for (const { filename, content } of agents.claudeAgents) {
      writeFileSync(join(dir, filename), content, "utf-8");
    }
  }
  if (agents.opencodeAgents) {
    const dir = join(root, ".opencode", "agents");
    mkdirSync(dir, { recursive: true });
    for (const { filename, content } of agents.opencodeAgents) {
      writeFileSync(join(dir, filename), content, "utf-8");
    }
  }
  return root;
}

const BASIC_AGENT = `---
name: test-agent
description: A test agent
tools: Bash,Read
---
You are a test agent.`;

const MINIMAL_AGENT = `---
description: Minimal agent
---
Do minimal things.`;

const NO_FRONTMATTER_AGENT = `Just a prompt with no frontmatter.`;

describe("claude-code-agent-loader", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  function trackDir(dir: string): string {
    dirs.push(dir);
    return dir;
  }

  describe("loadProjectAgents", () => {
    test("loads agents from <directory>/.claude/agents", () => {
      const root = trackDir(
        createProjectWithAgents({
          claudeAgents: [{ filename: "my-agent.md", content: BASIC_AGENT }],
        }),
      );

      const result = loadProjectAgents(root);

      expect(Object.keys(result)).toEqual(["test-agent"]);
      expect(result["test-agent"].description).toBe("(project) A test agent");
      expect(result["test-agent"].mode).toBe("subagent");
      expect(result["test-agent"].prompt).toBe("You are a test agent.");
      expect(result["test-agent"].tools).toEqual({ bash: true, read: true });
    });

    test("uses filename as agent name when frontmatter name is absent", () => {
      const root = trackDir(
        createProjectWithAgents({
          claudeAgents: [
            { filename: "fallback-name.md", content: MINIMAL_AGENT },
          ],
        }),
      );

      const result = loadProjectAgents(root);

      expect(Object.keys(result)).toEqual(["fallback-name"]);
      expect(result["fallback-name"].description).toBe(
        "(project) Minimal agent",
      );
    });

    test("handles agent with no frontmatter", () => {
      const root = trackDir(
        createProjectWithAgents({
          claudeAgents: [{ filename: "raw.md", content: NO_FRONTMATTER_AGENT }],
        }),
      );

      const result = loadProjectAgents(root);

      expect(Object.keys(result)).toEqual(["raw"]);
      expect(result["raw"].prompt).toBe("Just a prompt with no frontmatter.");
    });

    test("returns empty object when project has no .claude/agents directory", () => {
      const root = trackDir(mkdtempSync(join(tmpdir(), "agent-loader-test-")));

      const result = loadProjectAgents(root);

      expect(result).toEqual({});
    });

    test("ignores non-markdown files", () => {
      const root = trackDir(
        createProjectWithAgents({
          claudeAgents: [
            { filename: "good.md", content: BASIC_AGENT },
            { filename: "bad.txt", content: "not a markdown file" },
            { filename: "also-bad.json", content: "{}" },
          ],
        }),
      );

      const result = loadProjectAgents(root);

      expect(Object.keys(result)).toEqual(["test-agent"]);
    });

    test("loads multiple agents", () => {
      const root = trackDir(
        createProjectWithAgents({
          claudeAgents: [
            { filename: "agent-a.md", content: BASIC_AGENT },
            {
              filename: "agent-b.md",
              content: `---\nname: second-agent\ndescription: Another agent\n---\nDo other things.`,
            },
          ],
        }),
      );

      const result = loadProjectAgents(root);

      expect(Object.keys(result).sort()).toEqual([
        "second-agent",
        "test-agent",
      ]);
    });
  });

  describe("loadOpencodeProjectAgents", () => {
    test("loads agents from <directory>/.opencode/agents", () => {
      const root = trackDir(
        createProjectWithAgents({
          opencodeAgents: [{ filename: "oc-agent.md", content: BASIC_AGENT }],
        }),
      );

      const result = loadOpencodeProjectAgents(root);

      expect(Object.keys(result)).toEqual(["test-agent"]);
      expect(result["test-agent"].description).toBe(
        "(opencode-project) A test agent",
      );
      expect(result["test-agent"].mode).toBe("subagent");
      expect(result["test-agent"].prompt).toBe("You are a test agent.");
    });

    test("returns empty object when project has no .opencode/agents directory", () => {
      const root = trackDir(mkdtempSync(join(tmpdir(), "agent-loader-test-")));

      const result = loadOpencodeProjectAgents(root);

      expect(result).toEqual({});
    });
  });

  describe("loadUserAgents", () => {
    test("returns empty object when pointed at dir without agents/", () => {
      const root = trackDir(mkdtempSync(join(tmpdir(), "agent-loader-test-")))
      // Temporarily set env var — best-effort in parallel test runner
      const prev = process.env.CLAUDE_CONFIG_DIR
      try {
        process.env.CLAUDE_CONFIG_DIR = root
        const result = loadUserAgents()
        expect(result).toEqual({})
      } finally {
        if (prev !== undefined) process.env.CLAUDE_CONFIG_DIR = prev
        else delete process.env.CLAUDE_CONFIG_DIR
      }
    })
  })

  describe("loadOpencodeGlobalAgents", () => {
    test("returns empty object when pointed at dir without agents/", () => {
      const root = trackDir(mkdtempSync(join(tmpdir(), "agent-loader-test-")))
      const prev = process.env.OPENCODE_CONFIG_DIR
      try {
        process.env.OPENCODE_CONFIG_DIR = root
        const result = loadOpencodeGlobalAgents()
        expect(result).toEqual({})
      } finally {
        if (prev !== undefined) process.env.OPENCODE_CONFIG_DIR = prev
        else delete process.env.OPENCODE_CONFIG_DIR
      }
    })
  })

  describe("tools parsing", () => {
    test("parses comma-separated tools into boolean record", () => {
      const agentWithTools = `---\nname: tooled\ndescription: Has tools\ntools: Bash,Read,Edit\n---\nDo things.`;
      const root = trackDir(
        createProjectWithAgents({
          claudeAgents: [{ filename: "tooled.md", content: agentWithTools }],
        }),
      );

      const result = loadProjectAgents(root);

      expect(result["tooled"].tools).toEqual({
        bash: true,
        read: true,
        edit: true,
      });
    });

    test("omits tools when frontmatter tools field is absent", () => {
      const agentNoTools = `---\nname: no-tools\ndescription: No tools\n---\nDo things.`;
      const root = trackDir(
        createProjectWithAgents({
          claudeAgents: [{ filename: "no-tools.md", content: agentNoTools }],
        }),
      );

      const result = loadProjectAgents(root);

      expect(result["no-tools"].tools).toBeUndefined();
    });
  });

  describe("scope labeling", () => {
    test("project and opencode-project loaders apply correct scope prefixes", () => {
      const root = trackDir(mkdtempSync(join(tmpdir(), "agent-loader-scope-")))
      const content = `---\nname: scoped\ndescription: Scoped agent\n---\nPrompt.`

      const claudeProjectDir = join(root, "project", ".claude", "agents")
      const ocProjectDir = join(root, "project", ".opencode", "agents")

      mkdirSync(claudeProjectDir, { recursive: true })
      mkdirSync(ocProjectDir, { recursive: true })

      writeFileSync(join(claudeProjectDir, "a.md"), content, "utf-8")
      writeFileSync(join(ocProjectDir, "a.md"), content, "utf-8")

      const project = loadProjectAgents(join(root, "project"))
      const ocProject = loadOpencodeProjectAgents(join(root, "project"))

      expect(project["scoped"].description).toBe("(project) Scoped agent")
      expect(ocProject["scoped"].description).toBe("(opencode-project) Scoped agent")
    })
  })
});
