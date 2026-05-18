// script/build-binaries.test.ts
// Tests for platform binary build configuration

import { describe, expect, it } from "bun:test";

// Import PLATFORMS from build-binaries.ts
// We need to export it first, but for now we'll test the expected structure
const EXPECTED_BASELINE_TARGETS = [
  "bun-linux-x64-baseline",
  "bun-linux-x64-musl-baseline",
  "bun-darwin-x64-baseline",
  "bun-windows-x64-baseline",
];

describe("build-binaries", () => {
  describe("PLATFORMS array", () => {
    it("includes baseline variants for non-AVX2 CPU support", async () => {
      // given
      const module = await import("./build-binaries.ts");
      const platforms = (module as { PLATFORMS: { target: string }[] }).PLATFORMS;
      const targets = platforms.map((p) => p.target);

      // when
      const hasAllBaselineTargets = EXPECTED_BASELINE_TARGETS.every((baseline) =>
        targets.includes(baseline)
      );

      // then
      expect(hasAllBaselineTargets).toBe(true);
      for (const baseline of EXPECTED_BASELINE_TARGETS) {
        expect(targets).toContain(baseline);
      }
    });

    it("uses exact package names as platform package directories", async () => {
      // given
      const module = await import("./build-binaries.ts");
      const platforms = (module as { PLATFORMS: { packageName: string; packageDir: string }[] }).PLATFORMS;

      // when
      const packageNames = platforms.map((p) => p.packageName);
      const packageDirs = platforms.map((p) => p.packageDir);

      // then
      expect(packageDirs).toEqual(packageNames);
      expect(packageDirs).toContain("oh-my-opencode-linux-x64-baseline");
      expect(packageDirs).toContain("oh-my-opencode-linux-x64-musl-baseline");
      expect(packageDirs).toContain("oh-my-opencode-darwin-x64-baseline");
      expect(packageDirs).toContain("oh-my-opencode-windows-x64-baseline");
    });

    it("has correct binary names for baseline platforms", async () => {
      // given
      const module = await import("./build-binaries.ts");
      const platforms = (module as { PLATFORMS: { packageDir: string; target: string; binary: string }[] }).PLATFORMS;

      // when
      const windowsBaseline = platforms.find((p) => p.target === "bun-windows-x64-baseline");
      const linuxBaseline = platforms.find((p) => p.target === "bun-linux-x64-baseline");

      // then
      expect(windowsBaseline?.binary).toBe("oh-my-opencode.exe");
      expect(linuxBaseline?.binary).toBe("oh-my-opencode");
    });

    it("has descriptions mentioning no AVX2 for baseline platforms", async () => {
      // given
      const module = await import("./build-binaries.ts");
      const platforms = (module as { PLATFORMS: { target: string; description: string }[] }).PLATFORMS;

      // when
      const baselinePlatforms = platforms.filter((p) => p.target.includes("baseline"));

      // then
      for (const platform of baselinePlatforms) {
        expect(platform.description).toContain("no AVX2");
      }
    });
  });
});
