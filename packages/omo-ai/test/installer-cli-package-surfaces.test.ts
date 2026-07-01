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
