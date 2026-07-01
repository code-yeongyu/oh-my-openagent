import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  agentFile,
  cleanupAgentFixture,
  cliPath,
  createAgentFixture,
  createEmptyAgentFixture,
  expectedHookRecords,
  isRecord,
  packageEntries,
  packageRoot,
  parseStdoutJson,
  postinstallPath,
  readJsonObject,
  runCli,
  runNode,
} from "./installer-test-support";

describe("omo-ai senpi installer CLI", () => {
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

      // Then: the structured JSON error is returned with no backup or hook-state side effect.
      expect(repair.status).toBe(1);
      expect(repair.stderr).toBe("");
      expect(report["ok"]).toBe(false);
      expect(Array.isArray(report["problems"])).toBe(true);
      expect(String(report["problems"])).toContain("JSON Parse error");
      expect(readFileSync(settingsPath, "utf8")).toBe("{ malformed json");
      expect(settingsBackups).toEqual([]);
      expect(existsSync(agentFile(agentDir, "hooks-state.json"))).toBe(false);
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
      const env: Record<string, string | undefined> = { ...process.env, HOME: homeDir };
      delete env["OMO_AI_SENPI_AGENT_DIR"];
      delete env["PI_CODING_AGENT_DIR"];
      delete env["SENPI_CODING_AGENT_DIR"];

      // When: repair runs through the Node CLI with only HOME configured.
      const repair = spawnSync("node", [cliPath, "repair", "--json"], {
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

  it("exposes Node-runnable package bin, version, postinstall, and PI agent-dir override surfaces", () => {
    // Given: the npm package manifest and an isolated PI_CODING_AGENT_DIR.
    const agentDir = createEmptyAgentFixture();
    const manifest = readJsonObject(agentFile(packageRoot, "package.json"));

    try {
      // When: version and postinstall run with Node, without Bun.
      const version = runCli(["version"], agentDir);
      const flagVersion = runCli(["--version"], agentDir);
      const postinstall = runNode(postinstallPath, [], agentDir, packageRoot);

      // Then: public npm install surfaces are Node-runnable and use the override path.
      expect(isRecord(manifest["bin"]) ? manifest["bin"]["omo-ai"] : undefined).toBe(
        "./src/cli/index.mjs",
      );
      expect(isRecord(manifest["scripts"]) ? manifest["scripts"]["postinstall"] : undefined).toBe(
        "node ./src/install/postinstall.mjs",
      );
      expect(version.status).toBe(0);
      expect(version.stdout.trim()).toBe("omo-ai 4.15.0");
      expect(flagVersion.status).toBe(0);
      expect(flagVersion.stdout.trim()).toBe("omo-ai 4.15.0");
      expect(postinstall.status).toBe(0);
      expect(postinstall.stderr.trim()).toBe("");
      expect(existsSync(agentFile(agentDir, "settings.json"))).toBe(true);
      expect(packageEntries(readJsonObject(agentFile(agentDir, "settings.json"))).length).toBe(1);
    } finally {
      cleanupAgentFixture(agentDir);
    }
  });

  it("runs doctor JSON when the npm bin is invoked through a symlink", () => {
    // Given: npm global install invokes the package bin through a symlinked executable path.
    const agentDir = createEmptyAgentFixture();
    const binDir = createEmptyAgentFixture();
    const globalModulesDir = agentFile(binDir, "lib/node_modules");
    const linkedPackageRoot = join(globalModulesDir, "omo-ai");
    const symlinkedBin = agentFile(binDir, "omo-ai");

    try {
      const mkdir = spawnSync("mkdir", ["-p", globalModulesDir], {
        encoding: "utf8",
      });
      expect(mkdir.status).toBe(0);
      const packageLink = spawnSync("ln", ["-s", packageRoot, linkedPackageRoot], {
        encoding: "utf8",
      });
      expect(packageLink.status).toBe(0);
      const binLink = spawnSync("ln", ["-s", join(linkedPackageRoot, "src/cli/index.mjs"), symlinkedBin], {
        encoding: "utf8",
      });
      expect(binLink.status).toBe(0);
      const repair = runCli(["repair", "--json"], agentDir);
      expect(repair.status).toBe(0);

      // When: the symlinked global bin is invoked with Node.
      const doctor = spawnSync("node", [symlinkedBin, "doctor", "--json"], {
        cwd: packageRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          OMO_AI_SENPI_AGENT_DIR: agentDir,
          PI_CODING_AGENT_DIR: agentDir,
          SENPI_CODING_AGENT_DIR: agentDir,
        },
      });

      // Then: the CLI main runs and emits the doctor report instead of exiting silently.
      expect(doctor.status).toBe(0);
      expect(doctor.stderr.trim()).toBe("");
      expect(doctor.stdout.length > 0).toBe(true);
      const report = parseStdoutJson(doctor.stdout.trim());
      expect(report["action"]).toBe("doctor");
      expect(report["ok"]).toBe(true);
    } finally {
      cleanupAgentFixture(agentDir);
      cleanupAgentFixture(binDir);
    }
  });
});
