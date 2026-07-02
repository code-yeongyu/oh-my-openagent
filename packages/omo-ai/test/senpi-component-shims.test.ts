import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hooksPath, packageRoot, readHookCommands } from "./senpi-component-test-support";

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
