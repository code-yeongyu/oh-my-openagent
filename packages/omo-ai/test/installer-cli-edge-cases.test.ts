import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  agentFile,
  cleanupAgentFixture,
  cliPath,
  createDefaultHomeEnv,
  createEmptyAgentFixture,
  packageRoot,
  parseStdoutJson,
  runCli,
} from "./installer-test-support";

describe("omo-ai senpi installer CLI malformed files and defaults", () => {
  it("fails repair before mutating files when settings are malformed", () => {
    // Given: malformed settings and no hook trust state.
    const agentDir = createEmptyAgentFixture();
    const settingsPath = agentFile(agentDir, "settings.json");
    writeFileSync(settingsPath, "{ malformed json", "utf8");

    try {
      // When: repair is run through the public CLI.
      const repair = runCli(["repair", "--json"], agentDir);
      const report = parseStdoutJson(repair.stdout);
      const settingsBackups = readdirSync(agentDir).filter((name) => name.startsWith("settings.json.bak."));

      // Then: the structured JSON error is deterministic and returned with no backup or hook-state side effect.
      expect(repair.status).toBe(1);
      expect(repair.stderr).toBe("");
      expect(report["ok"]).toBe(false);
      expect(Array.isArray(report["problems"])).toBe(true);
      expect(String(report["problems"])).toContain(`${settingsPath} contains invalid JSON`);
      expect(String(report["problems"])).toContain("Original parse error:");
      expect(readFileSync(settingsPath, "utf8")).toBe("{ malformed json");
      expect(settingsBackups).toEqual([]);
      expect(existsSync(agentFile(agentDir, "hooks-state.json"))).toBe(false);
    } finally {
      cleanupAgentFixture(agentDir);
    }
  });

  it("fails repair before mutating files when settings are not a JSON object", () => {
    const agentDir = createEmptyAgentFixture();
    const settingsPath = agentFile(agentDir, "settings.json");
    writeFileSync(settingsPath, "[]\n", "utf8");

    try {
      const repair = runCli(["repair", "--json"], agentDir);
      const report = parseStdoutJson(repair.stdout);
      const settingsBackups = readdirSync(agentDir).filter((name) => name.startsWith("settings.json.bak."));

      expect(repair.status).toBe(1);
      expect(repair.stderr).toBe("");
      expect(report["ok"]).toBe(false);
      expect(String(report["problems"])).toContain("must contain a JSON object");
      expect(readFileSync(settingsPath, "utf8")).toBe("[]\n");
      expect(settingsBackups).toEqual([]);
      expect(existsSync(agentFile(agentDir, "hooks-state.json"))).toBe(false);
    } finally {
      cleanupAgentFixture(agentDir);
    }
  });

  it("fails repair before mutating settings when hook trust state is not a JSON object", () => {
    const agentDir = createEmptyAgentFixture();
    const settingsPath = agentFile(agentDir, "settings.json");
    const hooksStatePath = agentFile(agentDir, "hooks-state.json");
    const originalSettings = `${JSON.stringify({ packages: [], model: "keep-me" }, null, 2)}\n`;
    writeFileSync(settingsPath, originalSettings, "utf8");
    writeFileSync(hooksStatePath, "[]\n", "utf8");

    try {
      const repair = runCli(["repair", "--json"], agentDir);
      const report = parseStdoutJson(repair.stdout);
      const settingsBackups = readdirSync(agentDir).filter((name) => name.startsWith("settings.json.bak."));

      expect(repair.status).toBe(1);
      expect(repair.stderr).toBe("");
      expect(report["ok"]).toBe(false);
      expect(String(report["problems"])).toContain("must contain a JSON object");
      expect(readFileSync(settingsPath, "utf8")).toBe(originalSettings);
      expect(settingsBackups).toEqual([]);
    } finally {
      cleanupAgentFixture(agentDir);
    }
  });

  it("fails repair before mutating files when settings packages are not an array", () => {
    const agentDir = createEmptyAgentFixture();
    const settingsPath = agentFile(agentDir, "settings.json");
    const originalSettings = `${JSON.stringify({ packages: "bad", model: "keep-me" }, null, 2)}\n`;
    writeFileSync(settingsPath, originalSettings, "utf8");

    try {
      const repair = runCli(["repair", "--json"], agentDir);
      const report = parseStdoutJson(repair.stdout);
      const settingsBackups = readdirSync(agentDir).filter((name) => name.startsWith("settings.json.bak."));

      expect(repair.status).toBe(1);
      expect(repair.stderr).toBe("");
      expect(report["ok"]).toBe(false);
      expect(String(report["problems"])).toContain("packages must be an array");
      expect(readFileSync(settingsPath, "utf8")).toBe(originalSettings);
      expect(settingsBackups).toEqual([]);
      expect(existsSync(agentFile(agentDir, "hooks-state.json"))).toBe(false);
    } finally {
      cleanupAgentFixture(agentDir);
    }
  });

  it("fails repair before mutating settings when hook trust hooks are not an object", () => {
    const agentDir = createEmptyAgentFixture();
    const settingsPath = agentFile(agentDir, "settings.json");
    const hooksStatePath = agentFile(agentDir, "hooks-state.json");
    const originalSettings = `${JSON.stringify({ packages: [], model: "keep-me" }, null, 2)}\n`;
    const originalHookState = `${JSON.stringify({ version: 1, hooks: [] }, null, 2)}\n`;
    writeFileSync(settingsPath, originalSettings, "utf8");
    writeFileSync(hooksStatePath, originalHookState, "utf8");

    try {
      const repair = runCli(["repair", "--json"], agentDir);
      const report = parseStdoutJson(repair.stdout);
      const settingsBackups = readdirSync(agentDir).filter((name) => name.startsWith("settings.json.bak."));
      const hooksBackups = readdirSync(agentDir).filter((name) => name.startsWith("hooks-state.json.bak."));

      expect(repair.status).toBe(1);
      expect(repair.stderr).toBe("");
      expect(report["ok"]).toBe(false);
      expect(String(report["problems"])).toContain("hooks must be a JSON object");
      expect(readFileSync(settingsPath, "utf8")).toBe(originalSettings);
      expect(readFileSync(hooksStatePath, "utf8")).toBe(originalHookState);
      expect(settingsBackups).toEqual([]);
      expect(hooksBackups).toEqual([]);
    } finally {
      cleanupAgentFixture(agentDir);
    }
  });

  it("keeps fresh uninstall as a no-op without creating settings", () => {
    // Given: an empty isolated agent dir.
    const agentDir = createEmptyAgentFixture();
    const settingsPath = agentFile(agentDir, "settings.json");

    try {
      // When: uninstall runs before omo-ai has installed anything.
      const uninstall = runCli(["uninstall", "--json"], agentDir);
      const report = parseStdoutJson(uninstall.stdout);

      // Then: uninstall succeeds without materializing a settings file.
      expect(uninstall.status).toBe(0);
      expect(uninstall.stderr).toBe("");
      expect(report["ok"]).toBe(true);
      expect(report["packageEntryCount"]).toBe(0);
      expect(report["backupPaths"]).toEqual([]);
      expect(existsSync(settingsPath)).toBe(false);
    } finally {
      cleanupAgentFixture(agentDir);
    }
  });

  it("uses Senpi's current default agent directory when no overrides are set", () => {
    // Given: HOME points at an isolated directory with no Senpi agent overrides.
    const fixtureAgentDir = createEmptyAgentFixture();
    const homeDir = dirname(fixtureAgentDir);
    const expectedAgentDir = join(homeDir, ".senpi", "agent");

    try {
      const env = createDefaultHomeEnv(homeDir);

      // When: repair runs through the Node CLI with only default-home variables configured.
      const repair = spawnSync(process.execPath, [cliPath, "repair", "--json"], {
        cwd: packageRoot,
        encoding: "utf8",
        env,
      });
      const report = parseStdoutJson(repair.stdout.trim());

      // Then: files land under the source-compatible ~/.senpi/agent default, not ~/.pi/agent.
      expect(repair.status).toBe(0);
      expect(repair.stderr.trim()).toBe("");
      expect(report["settingsPath"]).toBe(join(expectedAgentDir, "settings.json"));
      expect(existsSync(join(expectedAgentDir, "settings.json"))).toBe(true);
      expect(existsSync(join(homeDir, ".pi", "agent", "settings.json"))).toBe(false);
    } finally {
      cleanupAgentFixture(fixtureAgentDir);
    }
  });
});
