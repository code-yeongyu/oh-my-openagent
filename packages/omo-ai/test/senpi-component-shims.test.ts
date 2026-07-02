import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../../..");
const packageRoot = join(repositoryRoot, "packages/omo-ai");
const hooksPath = join(packageRoot, "senpi/hooks/omo-senpi-hooks.json");

type HookCommand = {
  readonly command: string;
  readonly component: string;
  readonly runnerPath: string;
  readonly targetPath: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readHookCommands(): readonly HookCommand[] {
  const parsed: unknown = JSON.parse(readFileSync(hooksPath, "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed["hooks"])) {
    throw new TypeError("senpi hook payload must contain hooks");
  }
  return Object.values(parsed["hooks"])
    .flatMap((groups) => {
      if (!Array.isArray(groups)) {
        throw new TypeError("senpi hook event groups must be arrays");
      }
      return groups;
    })
    .flatMap(readGroupCommands)
    .map(resolveHookCommand);
}

function readGroupCommands(group: unknown): readonly string[] {
  if (!isRecord(group) || !Array.isArray(group["hooks"])) {
    throw new TypeError("senpi hook group must contain hooks");
  }
  return group["hooks"].flatMap((handler) => {
    if (!isRecord(handler) || handler["type"] !== "command") {
      return [];
    }
    const command = handler["command"];
    return typeof command === "string" ? [command] : [];
  });
}

function resolveHookCommand(command: string): HookCommand {
  const match = command.match(
    /^node "\$\{SENPI_HOOK_SOURCE%\/hooks\/omo-senpi-hooks\.json\}\/components\/run-hook\.mjs" ([a-z0-9-]+) hook [a-z-]+$/,
  );
  if (match === null || match[1] === undefined) {
    throw new TypeError(`unsupported hook command shape: ${command}`);
  }
  const component = match[1];
  return {
    command,
    component,
    runnerPath: join(packageRoot, "senpi/components/run-hook.mjs"),
    targetPath: join(packageRoot, "senpi/components", component, "dist/cli.js"),
  };
}

describe("senpi component hook shims", () => {
  it("points every emitted command hook at a packaged senpi component CLI target", () => {
    // Given: Senpi loads commands relative to the installed omo-ai package root.
    const commands = readHookCommands();

    // When: every command target is resolved against the package root.
    const missingTargets = commands.filter((command) =>
      !existsSync(command.runnerPath) || !existsSync(command.targetPath)
    );

    // Then: commands use the package-owned senpi component tree and every target exists.
    expect(commands.length).toBe(11);
    expect(
      commands.every((command) =>
        command.command.includes("${SENPI_HOOK_SOURCE%/hooks/omo-senpi-hooks.json}/components/run-hook.mjs"),
      ),
    ).toBe(true);
    expect(missingTargets).toEqual([]);
  });

  it("runs a packaged senpi component hook command and records a safe marker", () => {
    // Given: the installed hook command receives Senpi's hook-source environment.
    const pluginData = mkdtempSync(join(tmpdir(), "omo-ai-component-marker-"));
    const command = readHookCommands().find((candidate) => candidate.component === "rules");

    try {
      if (command === undefined) {
        throw new TypeError("rules hook command must exist");
      }

      // When: the package hook runner is run with Senpi's hook-source environment.
      const result = spawnSync("node", [command.runnerPath, "rules", "hook", "session-start"], {
        cwd: packageRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          SENPI_HOOK_SOURCE: hooksPath,
          PLUGIN_DATA: pluginData,
        },
      });
      const markerPath = join(pluginData, "senpi-component-hooks.jsonl");

      // Then: the shim exits cleanly, prints nothing sensitive, and records the hook marker.
      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe("");
      expect(result.stdout.trim()).toBe("");
      expect(readFileSync(markerPath, "utf8")).toContain(
        '"component":"rules","argv":["hook","session-start"]',
      );
    } finally {
      rmSync(pluginData, { recursive: true, force: true });
    }
  });

  it("emits Senpi-compatible LSP diagnostics feedback and still records the marker", () => {
    // Given: the LSP hook receives a PostToolUse edit payload and deterministic diagnostics text.
    const pluginData = mkdtempSync(join(tmpdir(), "omo-ai-lsp-marker-"));
    const command = readHookCommands().find((candidate) => candidate.component === "lsp");
    const hookInput = {
      sessionId: "senpi-lsp-fixture",
      toolName: "edit",
      toolInput: {
        path: "/tmp/example.py",
      },
      toolResponse: {},
    };

    try {
      if (command === undefined) {
        throw new TypeError("lsp hook command must exist");
      }

      // When: the package-local LSP component CLI runs in hook mode.
      const result = spawnSync("sh", ["-c", 'printf "%s" "$HOOK_INPUT" | node "$HOOK_TARGET" hook post-tool-use'], {
        cwd: packageRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          HOOK_INPUT: JSON.stringify(hookInput),
          HOOK_TARGET: command.targetPath,
          PLUGIN_DATA: pluginData,
          OMO_AI_LSP_DIAGNOSTICS_TEXT:
            "error[reportAssignmentType] (1) at 1:1: Expression of type str cannot be assigned to int",
        },
      });
      const markerPath = join(pluginData, "senpi-component-hooks.jsonl");
      const output = JSON.parse(result.stdout);

      // Then: diagnostics become a blocking Senpi hook response and the QA marker survives.
      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe("");
      expect(output["decision"]).toBe("block");
      expect(typeof output["reason"]).toBe("string");
      expect(output["hookSpecificOutput"]["hookEventName"]).toBe("PostToolUse");
      expect(output["hookSpecificOutput"]["additionalContext"]).toContain(
        "LSP diagnostics after editing /tmp/example.py",
      );
      expect(output["reason"]).toContain(
        "error[reportAssignmentType] (1) at 1:1: Expression of type str cannot be assigned to int",
      );
      expect(readFileSync(markerPath, "utf8")).toContain(
        '"component":"lsp","argv":["hook","post-tool-use"]',
      );
    } finally {
      rmSync(pluginData, { recursive: true, force: true });
    }
  });

  it("keeps the LSP hook marker-only when diagnostics text is not configured", () => {
    // Given: the LSP hook fires for an edit but no deterministic diagnostics text is configured.
    const pluginData = mkdtempSync(join(tmpdir(), "omo-ai-lsp-marker-only-"));
    const command = readHookCommands().find((candidate) => candidate.component === "lsp");

    try {
      if (command === undefined) {
        throw new TypeError("lsp hook command must exist");
      }

      // When: the package-local LSP component CLI runs in hook mode.
      const result = spawnSync("sh", ["-c", 'printf "%s" "$HOOK_INPUT" | node "$HOOK_TARGET" hook post-tool-use'], {
        cwd: packageRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          HOOK_INPUT: JSON.stringify({
            session_id: "senpi-lsp-no-diagnostics",
            tool_name: "Write",
            tool_input: {
              file_path: "/tmp/example.py",
            },
            tool_response: {},
          }),
          HOOK_TARGET: command.targetPath,
          PLUGIN_DATA: pluginData,
          OMO_AI_LSP_DIAGNOSTICS_TEXT: "",
        },
      });
      const markerPath = join(pluginData, "senpi-component-hooks.jsonl");

      // Then: no fake LSP feedback is emitted, but hook dispatch remains observable.
      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe("");
      expect(result.stdout.trim()).toBe("");
      expect(readFileSync(markerPath, "utf8")).toContain(
        '"component":"lsp","argv":["hook","post-tool-use"]',
      );
    } finally {
      rmSync(pluginData, { recursive: true, force: true });
    }
  });

  it("extracts edited paths from common Senpi and Codex hook payload shapes", () => {
    // Given: Senpi/Codex PostToolUse payloads can name edited files in several places.
    const command = readHookCommands().find((candidate) => candidate.component === "lsp");
    const cases = [
      {
        input: {
          tool_name: "Write",
          tool_input: { file_path: "/tmp/file-path.py" },
          tool_response: {},
        },
        path: "/tmp/file-path.py",
      },
      {
        input: {
          tool_name: "edit",
          tool_input: { path: "/tmp/path.py" },
          tool_response: {},
        },
        path: "/tmp/path.py",
      },
      {
        input: {
          tool_name: "Bash",
          tool_input: {
            command: "apply_patch <<'PATCH'\n*** Begin Patch\n*** Update File: /tmp/patch-command.py\n@@\n*** End Patch\nPATCH",
          },
          tool_response: {},
        },
        path: "/tmp/patch-command.py",
      },
      {
        input: {
          tool_name: "unknown",
          tool_input: {},
          tool_response: {
            content: "*** Begin Patch\n*** Update File: /tmp/tool-response.py\n@@\n*** End Patch",
          },
        },
        path: "/tmp/tool-response.py",
      },
    ];

    if (command === undefined) {
      throw new TypeError("lsp hook command must exist");
    }

    for (const testCase of cases) {
      // When: the LSP hook receives a diagnostics fixture for the edited file shape.
      const result = spawnSync("sh", ["-c", 'printf "%s" "$HOOK_INPUT" | node "$HOOK_TARGET" hook post-tool-use'], {
        cwd: packageRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          HOOK_INPUT: JSON.stringify(testCase.input),
          HOOK_TARGET: command.targetPath,
          OMO_AI_LSP_DIAGNOSTICS_TEXT: "error[test] (1) at 1:1: bad",
        },
      });
      const output = JSON.parse(result.stdout);

      // Then: each supported shape maps to a Senpi blocking response for that path.
      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe("");
      expect(output["decision"]).toBe("block");
      expect(output["reason"]).toContain(`LSP diagnostics after editing ${testCase.path}:`);
    }
  });

  it("keeps non-lsp component shims marker-only", () => {
    // Given: a non-LSP component still uses the compatibility marker shim.
    const pluginData = mkdtempSync(join(tmpdir(), "omo-ai-non-lsp-marker-"));
    const command = readHookCommands().find((candidate) => candidate.component === "rules");

    try {
      if (command === undefined) {
        throw new TypeError("rules hook command must exist");
      }

      // When: the non-LSP component receives stdin that an LSP hook would inspect.
      const result = spawnSync("sh", ["-c", 'printf "%s" "$HOOK_INPUT" | node "$HOOK_TARGET" hook session-start'], {
        cwd: packageRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          HOOK_INPUT: JSON.stringify({ session_id: "non-lsp", tool_name: "edit" }),
          HOOK_TARGET: command.targetPath,
          PLUGIN_DATA: pluginData,
          OMO_AI_LSP_DIAGNOSTICS_TEXT:
            "error[fixture] (1) at 1:1: non-lsp components must not emit this",
        },
      });

      // Then: no broad non-LSP behavior changed.
      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe("");
      expect(result.stdout.trim()).toBe("");
    } finally {
      rmSync(pluginData, { recursive: true, force: true });
    }
  });
});
