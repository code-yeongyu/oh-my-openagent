import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  agentFile,
  cleanupAgentFixture,
  createEmptyAgentFixture,
  packageRoot,
} from "./installer-test-support";
import { createFakeSenpi, createLinkedNpmBin } from "./installer-npm-bin-test-support";

describe("omo-ai omoai npm launcher", () => {
  it("launches senpi through the shipped omoai npm bin with an invocation-local package root", () => {
    // Given: npm global install exposes an omoai linked bin and senpi is available on PATH.
    const binDir = createEmptyAgentFixture();
    const globalModulesDir = agentFile(binDir, "lib/node_modules");
    const linkedPackageRoot = join(globalModulesDir, "omo-ai");
    const symlinkedBin = agentFile(binDir, "omoai");
    const fakeSenpiDir = agentFile(binDir, "fake-bin");
    const capturePath = agentFile(binDir, "senpi-argv.json");

    try {
      const invokedBin = createLinkedNpmBin(
        globalModulesDir,
        linkedPackageRoot,
        symlinkedBin,
        "src/cli/omoai.mjs",
      );
      createFakeSenpi(fakeSenpiDir, capturePath);

      // When: the installed omoai launcher is invoked with original Senpi args.
      const launched = spawnSync(process.execPath, [invokedBin, "list", "--no-approve"], {
        cwd: packageRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeSenpiDir}${process.platform === "win32" ? ";" : ":"}${process.env["PATH"] ?? ""}`,
        },
      });

      // Then: omoai delegates to senpi -e <packageRoot> while preserving the original args.
      expect(launched.status).toBe(0);
      expect(launched.stderr.trim()).toBe("");
      expect(JSON.parse(readFileSync(capturePath, "utf8"))).toEqual({
        argv: ["-e", packageRoot, "list", "--no-approve"],
      });
    } finally {
      cleanupAgentFixture(binDir);
    }
  });
});
