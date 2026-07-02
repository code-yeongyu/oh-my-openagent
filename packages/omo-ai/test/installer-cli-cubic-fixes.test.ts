import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  agentFile,
  cleanupAgentFixture,
  cliPath,
  createEmptyAgentFixture,
  isRecord,
  packageEntries,
  packageRoot,
  parseStdoutJson,
  readJsonObject,
} from "./installer-test-support";

const hooksManifestPath = join(packageRoot, "senpi/hooks/omo-senpi-hooks.json");
const packageRootModulePath = join(packageRoot, "src/senpi-compat/package-root.mjs");
const senpiCompatIndexPath = join(packageRoot, "src/senpi-compat/index.ts");
const supportedSenpiEvents = new Set([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "SessionStart",
  "PreCompact",
  "PostCompact",
  "Stop",
]);

describe("omo-ai Cubic review fixes", () => {
  it("matches existing ~/ package sources with USERPROFILE when HOME is absent", () => {
    const agentDir = createEmptyAgentFixture();
    const settingsPath = agentFile(agentDir, "settings.json");
    const userProfile = dirname(packageRoot);
    const packageRootParts = packageRoot.split(/[\\/]/);
    const packageRootName = packageRootParts[packageRootParts.length - 1] ?? "omo-ai";
    const tildePackageSource = `~/${packageRootName}`;
    writeFileSync(
      settingsPath,
      `${JSON.stringify({ packages: [{ source: tildePackageSource }, { source: "/tmp/other" }] }, null, 2)}\n`,
      "utf8",
    );

    try {
      const env: Record<string, string | undefined> = {
        ...process.env,
        USERPROFILE: userProfile,
        OMO_AI_SENPI_AGENT_DIR: agentDir,
        PI_CODING_AGENT_DIR: agentDir,
        SENPI_CODING_AGENT_DIR: agentDir,
      };
      delete env["HOME"];

      const repair = spawnSync(process.execPath, [cliPath, "repair", "--json"], {
        cwd: packageRoot,
        encoding: "utf8",
        env,
      });

      expect(repair.status).toBe(0);
      expect(repair.stderr.trim()).toBe("");
      const report = parseStdoutJson(repair.stdout.trim());
      const settings = readJsonObject(settingsPath);
      const packages = settings["packages"];
      expect(report["packageEntryCount"]).toBe(1);
      expect(packageEntries(settings).length).toBe(1);
      expect(Array.isArray(packages)).toBe(true);
      expect(JSON.stringify(packages).includes(tildePackageSource)).toBe(false);
    } finally {
      cleanupAgentFixture(agentDir);
    }
  });

  it("keeps every raw Senpi hook manifest key inside the supported event set", () => {
    const parsed: unknown = JSON.parse(readFileSync(hooksManifestPath, "utf8"));
    if (!isRecord(parsed) || !isRecord(parsed["hooks"])) {
      throw new TypeError("omo-senpi-hooks.json must contain a hooks object");
    }

    const rawHookKeys = Object.keys(parsed["hooks"]).sort();
    const unsupportedRawHookKeys = rawHookKeys.filter((key) => !supportedSenpiEvents.has(key));

    expect(rawHookKeys.length > 0).toBe(true);
    expect(unsupportedRawHookKeys).toEqual([]);
  });

  it("derives the runtime package version from package.json", async () => {
    const manifest = readJsonObject(join(packageRoot, "package.json"));
    const moduleSource = readFileSync(packageRootModulePath, "utf8");
    const tsSource = readFileSync(senpiCompatIndexPath, "utf8");
    const runtimeVersion = spawnSync(
      process.execPath,
      ["-e", "import('./src/senpi-compat/package-root.mjs').then((m)=>console.log(m.OMO_AI_PACKAGE_VERSION))"],
      {
        cwd: packageRoot,
        encoding: "utf8",
      },
    );

    expect(runtimeVersion.status).toBe(0);
    expect(runtimeVersion.stderr.trim()).toBe("");
    expect(runtimeVersion.stdout.trim()).toBe(manifest["version"]);
    expect(moduleSource.includes('export const OMO_AI_PACKAGE_VERSION = "')).toBe(false);
    expect(tsSource.includes('export const OMO_AI_PACKAGE_VERSION = "')).toBe(false);
    expect(tsSource.includes("packageManifest.version")).toBe(true);
  });
});
