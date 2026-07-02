import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  agentFile,
  cleanupAgentFixture,
  createEmptyAgentFixture,
  isRecord,
  packageEntries,
  packageRoot,
  parseStdoutJson,
  postinstallPath,
  readJsonObject,
  runCli,
  runNode,
} from "./installer-test-support";
import { expectedHookRecords } from "./installer-hook-trust-test-support";
import { createLinkedNpmBin } from "./installer-npm-bin-test-support";

describe("omo-ai senpi installer CLI package surfaces", () => {
  it("exposes Node-runnable package bins, version, postinstall, and PI agent-dir override surfaces", () => {
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
      expect(isRecord(manifest["bin"]) ? manifest["bin"]["omoai"] : undefined).toBe(
        "./src/cli/omoai.mjs",
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
      expect(existsSync(agentFile(agentDir, "settings.json"))).toBe(false);

      const hooksState = readJsonObject(agentFile(agentDir, "hooks-state.json"));
      const hooks = hooksState["hooks"];
      if (!isRecord(hooks)) {
        throw new TypeError("postinstall hooks-state hooks must be an object");
      }
      const expectedRecords = expectedHookRecords(String(parsePostinstallUpdatedAt(hooks)));
      expect(Object.keys(hooks).sort()).toEqual(expectedRecords.map((record) => record.id).sort());
      for (const record of expectedRecords) {
        expect(hooks[record.id]).toEqual(record.entry);
      }

      const doctor = runCli(["doctor", "--json"], agentDir);
      const doctorReport = parseStdoutJson(doctor.stdout.trim());
      expect(doctor.status).toBe(0);
      expect(doctorReport["action"]).toBe("doctor");
      expect(doctorReport["ok"]).toBe(true);
      expect(doctorReport["packageEntryCount"]).toBe(0);
      expect(doctorReport["missingTrustEntries"]).toEqual([]);
    } finally {
      cleanupAgentFixture(agentDir);
    }
  });

  it("keeps existing senpi settings free of omo-ai package registration during postinstall", () => {
    // Given: Senpi settings already exist with an unrelated package.
    const agentDir = createEmptyAgentFixture();
    const settingsPath = agentFile(agentDir, "settings.json");
    const hooksStatePath = agentFile(agentDir, "hooks-state.json");
    writeFileSync(
      settingsPath,
      `${JSON.stringify({ packages: [{ source: "/tmp/other-senpi-package" }], model: "keep-me" }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      hooksStatePath,
      `${JSON.stringify({
        version: 1,
        hooks: {
          hk_unrelated: {
            enabled: true,
            trustedHash: "sha256:unrelated",
            scope: "global",
            sourcePath: "/tmp/other/hooks.json",
            commandPreview: "node other.js",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          hk_stale_omo: {
            enabled: true,
            trustedHash: "sha256:stale-omo",
            scope: "global",
            sourcePath: "/tmp/old/packages/omo-ai/senpi/hooks/omo-senpi-hooks.json",
            commandPreview: "node /tmp/old/packages/omo-ai/senpi/hooks/components/run-hook.mjs",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          hk_stale_omo_direct_component: {
            enabled: true,
            trustedHash: "sha256:stale-omo-direct-component",
            scope: "global",
            sourcePath: "/tmp/old/packages/omo-ai/senpi/hooks/omo-senpi-hooks.json",
            commandPreview: 'node "${PLUGIN_ROOT}/senpi/components/rules/dist/cli.js" hook session-start',
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    try {
      // When: npm postinstall runs in the isolated Senpi agent dir.
      const postinstall = runNode(postinstallPath, [], agentDir, packageRoot);
      const settings = readJsonObject(settingsPath);
      const hooksState = readJsonObject(hooksStatePath);
      const hooks = hooksState["hooks"];
      if (!isRecord(hooks)) {
        throw new TypeError("postinstall hooks-state hooks must be an object");
      }

      // Then: postinstall may trust exact OMO hooks, but it does not opt plain senpi into omo-ai.
      expect(postinstall.status).toBe(0);
      expect(postinstall.stderr.trim()).toBe("");
      expect(packageEntries(settings)).toEqual([]);
      expect(settings["packages"]).toEqual([{ source: "/tmp/other-senpi-package" }]);
      expect(settings["model"]).toBe("keep-me");
      expect(hooks["hk_unrelated"] !== undefined).toBe(true);
      expect(hooks["hk_stale_omo"]).toBe(undefined);
      expect(hooks["hk_stale_omo_direct_component"]).toBe(undefined);
    } finally {
      cleanupAgentFixture(agentDir);
    }
  });

  it("exports real installer and doctor runtime modules instead of skeleton stubs", () => {
    const installProbe = spawnSync(
      "node",
      [
        "-e",
        "import('omo-ai/install').then((m)=>console.log([typeof m.repairSenpiInstall, typeof m.uninstallSenpiInstall, typeof m.inspectSenpiInstall].join(',')))",
      ],
      {
        cwd: packageRoot,
        encoding: "utf8",
      },
    );
    const doctorProbe = spawnSync(
      "node",
      ["-e", "import('omo-ai/doctor').then((m)=>console.log(typeof m.doctorSenpiInstall))"],
      {
        cwd: packageRoot,
        encoding: "utf8",
      },
    );

    expect(installProbe.status).toBe(0);
    expect(installProbe.stderr.trim()).toBe("");
    expect(installProbe.stdout.trim()).toBe("function,function,function");
    expect(doctorProbe.status).toBe(0);
    expect(doctorProbe.stderr.trim()).toBe("");
    expect(doctorProbe.stdout.trim()).toBe("function");
  });

  it("runs doctor JSON when the npm bin is invoked through npm-style links", () => {
    // Given: npm global install invokes the package bin through a linked package/bin path.
    const agentDir = createEmptyAgentFixture();
    const binDir = createEmptyAgentFixture();
    const globalModulesDir = agentFile(binDir, "lib/node_modules");
    const linkedPackageRoot = join(globalModulesDir, "omo-ai");
    const symlinkedBin = agentFile(binDir, "omo-ai");

    try {
      const invokedBin = createLinkedNpmBin(
        globalModulesDir,
        linkedPackageRoot,
        symlinkedBin,
        "src/cli/index.mjs",
      );
      const repair = runCli(["repair", "--json"], agentDir);
      expect(repair.status).toBe(0);

      // When: the npm-style global bin is invoked with Node.
      const doctor = spawnSync(process.execPath, [invokedBin, "doctor", "--json"], {
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

function parsePostinstallUpdatedAt(hooks: Record<string, unknown>): string {
  const firstHook = hooks[Object.keys(hooks)[0] ?? ""];
  if (!isRecord(firstHook) || typeof firstHook["updatedAt"] !== "string") {
    throw new TypeError("postinstall hook trust entry must have updatedAt");
  }
  return firstHook["updatedAt"];
}
