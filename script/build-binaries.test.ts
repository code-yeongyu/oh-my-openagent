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

    it("has correct directory names for baseline platforms", async () => {
      // given
      const module = await import("./build-binaries.ts");
      const platforms = (module as { PLATFORMS: { dir: string; target: string }[] }).PLATFORMS;

      // when
      const baselinePlatforms = platforms.filter((p) => p.target.includes("baseline"));

      // then
      expect(baselinePlatforms.length).toBe(4);
      expect(baselinePlatforms.map((p) => p.dir)).toContain("linux-x64-baseline");
      expect(baselinePlatforms.map((p) => p.dir)).toContain("linux-x64-musl-baseline");
      expect(baselinePlatforms.map((p) => p.dir)).toContain("darwin-x64-baseline");
      expect(baselinePlatforms.map((p) => p.dir)).toContain("windows-x64-baseline");
    });

    it("has correct binary names for baseline platforms", async () => {
      // given
      const module = await import("./build-binaries.ts");
      const platforms = (module as { PLATFORMS: { dir: string; target: string; binary: string }[] }).PLATFORMS;

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
