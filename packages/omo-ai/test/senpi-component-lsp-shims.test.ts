import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageRoot, readHookCommands } from "./senpi-component-test-support";

describe("senpi component LSP hook shims", () => {
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

  it("blocks malformed LSP hook stdin without requiring an edited file path", () => {
    // Given: the LSP hook receives malformed non-empty stdin while diagnostics are configured.
    const pluginData = mkdtempSync(join(tmpdir(), "omo-ai-lsp-malformed-"));
    const command = readHookCommands().find((candidate) => candidate.component === "lsp");

    try {
      if (command === undefined) {
        throw new TypeError("lsp hook command must exist");
      }

      // When: the packaged component CLI runs the PostToolUse hook with invalid JSON.
      const result = spawnSync("sh", ["-c", 'printf "%s" "$HOOK_INPUT" | node "$HOOK_TARGET" hook post-tool-use'], {
        cwd: packageRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          HOOK_INPUT: "{not-json",
          HOOK_TARGET: command.targetPath,
          PLUGIN_DATA: pluginData,
          OMO_AI_LSP_DIAGNOSTICS_TEXT: "error[test] (1) at 1:1: deterministic diagnostics",
        },
      });
      const output = JSON.parse(result.stdout);

      // Then: malformed input fails closed as a Senpi blocking response without needing a file path.
      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe("");
      expect(output["decision"]).toBe("block");
      expect(output["hookSpecificOutput"]["hookEventName"]).toBe("PostToolUse");
      const reason = String(output["reason"]);
      const additionalContext = String(output["hookSpecificOutput"]["additionalContext"]);
      expect(/malformed|invalid/i.test(reason)).toBe(true);
      expect(/malformed|invalid/i.test(additionalContext)).toBe(true);
      expect(reason.includes("after editing")).toBe(false);
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
});
