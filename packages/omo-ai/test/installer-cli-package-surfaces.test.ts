import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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

describe("omo-ai senpi installer CLI package surfaces", () => {
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
      const invokedBin = createLinkedNpmBin(globalModulesDir, linkedPackageRoot, symlinkedBin);
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

function createLinkedNpmBin(globalModulesDir: string, linkedPackageRoot: string, symlinkedBin: string): string {
  const setup = spawnSync(
    process.execPath,
    [
      "-e",
      `
const { mkdirSync, symlinkSync } = require("node:fs");
const { join } = require("node:path");
const [globalModulesDir, packageRoot, linkedPackageRoot, symlinkedBin] = process.argv.slice(1);
mkdirSync(globalModulesDir, { recursive: true });
symlinkSync(packageRoot, linkedPackageRoot, process.platform === "win32" ? "junction" : "dir");
const target = join(linkedPackageRoot, "src/cli/index.mjs");
if (process.platform === "win32") {
  console.log(target);
  process.exit(0);
}
symlinkSync(target, symlinkedBin, "file");
console.log(symlinkedBin);
`,
      globalModulesDir,
      packageRoot,
      linkedPackageRoot,
      symlinkedBin,
    ],
    { encoding: "utf8" },
  );
  expect(setup.status).toBe(0);
  expect(setup.stderr.trim()).toBe("");
  return setup.stdout.trim();
}
