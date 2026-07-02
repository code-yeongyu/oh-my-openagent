import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  agentFile,
  cleanupAgentFixture,
  createAgentFixture,
  createEmptyAgentFixture,
  isRecord,
  packageEntries,
  packageRoot,
  parseStdoutJson,
  readJsonObject,
  runCli,
} from "./installer-test-support";
import { expectedHookRecords } from "./installer-hook-trust-test-support";

describe("omo-ai senpi installer CLI repair and uninstall", () => {
  it("repairs settings and hook trust idempotently when an isolated agent dir is provided", () => {
    // Given: an existing senpi agent dir with duplicate OMO package entries and unrelated trust.
    const agentDir = createAgentFixture();
    const settingsPath = agentFile(agentDir, "settings.json");
    const hooksStatePath = agentFile(agentDir, "hooks-state.json");

    try {
      // When: repair is run through the Node-runnable CLI surface.
      const first = runCli(["repair", "--json"], agentDir);
      const firstReport = parseStdoutJson(first.stdout);
      const settings = readJsonObject(settingsPath);
      const trustState = readJsonObject(hooksStatePath);
      const hooks = trustState["hooks"];
      if (!isRecord(hooks)) {
        throw new TypeError("hooks-state hooks must be an object");
      }
      const expectedRecords = expectedHookRecords(String(firstReport["updatedAt"]));

      // Then: exactly one local package entry and exact OMO trust entries are written.
      expect(first.status).toBe(0);
      expect(first.stderr).toBe("");
      expect(firstReport["packageEntryCount"]).toBe(1);
      expect(firstReport["omoTrustEntryCount"]).toBe(expectedRecords.length);
      expect(firstReport["problems"]).toEqual([]);
      expect(firstReport["settingsPath"]).toBe(settingsPath);
      expect(firstReport["hooksStatePath"]).toBe(hooksStatePath);
      expect(firstReport["packageRoot"]).toBe(packageRoot);
      expect(firstReport["payloadRoot"]).toBe(join(packageRoot, "senpi"));
      expect(packageEntries(settings)).toEqual([
        {
          source: packageRoot,
          extensions: ["senpi/extensions/**/*"],
          skills: ["senpi/skills/**/*.md"],
          prompts: ["senpi/prompts/**/*.md"],
          hooks: ["senpi/hooks/omo-senpi-hooks.json"],
        },
      ]);
      for (const record of expectedRecords) {
        expect(hooks[record.id]).toEqual(record.entry);
      }
      expect(hooks["hk_stale_omo_direct_component"]).toBe(undefined);
      const expectedRecordIds = new Set(expectedRecords.map((record) => record.id));
      expect(
        Object.entries(hooks).some(([id, entry]) => {
          return isRecord(entry) &&
            !expectedRecordIds.has(id) &&
            typeof entry["sourcePath"] === "string" &&
            entry["sourcePath"].includes("packages/omo-ai/senpi/hooks/omo-senpi-hooks.json");
        }),
      ).toBe(false);
      expect(hooks["hk_unrelated"] !== undefined).toBe(true);
      expect(String(firstReport["backupPaths"])).toContain(`${settingsPath}.bak.`);
      expect(String(firstReport["backupPaths"])).toContain(`${hooksStatePath}.bak.`);
      expect(dirname(String(firstReport["settingsPath"]))).toBe(agentDir);

      // When: repair runs again against already-correct files.
      const second = runCli(["repair", "--json"], agentDir);
      const secondReport = parseStdoutJson(second.stdout);

      // Then: it is a no-op with no extra backups or duplicate entries.
      expect(second.status).toBe(0);
      expect(secondReport["packageEntryCount"]).toBe(1);
      expect(secondReport["omoTrustEntryCount"]).toBe(expectedRecords.length);
      expect(secondReport["backupPaths"]).toEqual([]);
      expect(packageEntries(readJsonObject(settingsPath)).length).toBe(1);
    } finally {
      cleanupAgentFixture(agentDir);
    }
  });

  it("reports doctor JSON and uninstalls only OMO-owned state", () => {
    // Given: an isolated agent dir repaired by omo-ai.
    const agentDir = createAgentFixture();
    const settingsPath = agentFile(agentDir, "settings.json");
    const hooksStatePath = agentFile(agentDir, "hooks-state.json");

    try {
      const repair = runCli(["repair", "--json"], agentDir);
      expect(repair.status).toBe(0);

      // When: doctor and uninstall are run through the Node CLI.
      const doctor = runCli(["doctor", "--json"], agentDir);
      const doctorReport = parseStdoutJson(doctor.stdout);
      const uninstall = runCli(["uninstall", "--json"], agentDir);
      const uninstallReport = parseStdoutJson(uninstall.stdout);
      const settings = readJsonObject(settingsPath);
      const trustState = readJsonObject(hooksStatePath);
      const hooks = trustState["hooks"];

      // Then: doctor is clean, and uninstall removes only OMO-owned entries.
      expect(doctor.status).toBe(0);
      expect(doctorReport["ok"]).toBe(true);
      expect(doctorReport["problems"]).toEqual([]);
      expect(doctorReport["missingTrustEntries"]).toEqual([]);
      expect(uninstall.status).toBe(0);
      expect(uninstallReport["packageEntryCount"]).toBe(0);
      expect(uninstallReport["omoTrustEntryCount"]).toBe(0);
      expect(packageEntries(settings)).toEqual([]);
      expect(settings["model"]).toBe("keep-me");
      expect(isRecord(hooks) ? Object.keys(hooks) : []).toEqual(["hk_unrelated"]);
      expect(String(uninstallReport["backupPaths"])).toContain(`${settingsPath}.bak.`);
      expect(String(uninstallReport["backupPaths"])).toContain(`${hooksStatePath}.bak.`);
    } finally {
      cleanupAgentFixture(agentDir);
    }
  });

  it("fails repair before mutating settings when hook trust state is malformed", () => {
    // Given: valid settings that need repair, and malformed hook trust state.
    const agentDir = createEmptyAgentFixture();
    const settingsPath = agentFile(agentDir, "settings.json");
    const hooksStatePath = agentFile(agentDir, "hooks-state.json");
    const originalSettings = `${JSON.stringify({ packages: [], model: "keep-me" }, null, 2)}\n`;
    writeFileSync(settingsPath, originalSettings, "utf8");
    writeFileSync(hooksStatePath, "{ malformed json", "utf8");

    try {
      // When: repair is run through the public CLI.
      const repair = runCli(["repair", "--json"], agentDir);
      const report = parseStdoutJson(repair.stdout);
      const settingsBackups = readdirSync(agentDir).filter((name) => name.startsWith("settings.json.bak."));

      // Then: the parse failure is reported as JSON and settings are untouched.
      expect(repair.status).toBe(1);
      expect(repair.stderr).toBe("");
      expect(report["ok"]).toBe(false);
      expect(Array.isArray(report["problems"])).toBe(true);
      expect(String(report["problems"])).toContain("JSON Parse error");
      expect(readFileSync(settingsPath, "utf8")).toBe(originalSettings);
      expect(settingsBackups).toEqual([]);
    } finally {
      cleanupAgentFixture(agentDir);
    }
  });
});
