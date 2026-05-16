import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testRoot = "";

describe("findProjectRoot", () => {
  afterEach(() => {
    if (testRoot) {
      rmSync(testRoot, { recursive: true, force: true });
      testRoot = "";
    }
  });

  it("memoizes repeated lookups for the same start path and resets on cache clear", async () => {
    // given
    testRoot = join(tmpdir(), `rules-project-root-${Date.now()}-${Math.random()}`);
    const projectRoot = join(testRoot, "project");
    const sourceDirectory = join(projectRoot, "src");
    const startPath = join(sourceDirectory, "file.ts");
    const packageJsonPath = join(projectRoot, "package.json");
    mkdirSync(sourceDirectory, { recursive: true });
    writeFileSync(startPath, "export const value = 1;\n");
    writeFileSync(packageJsonPath, "{}\n");

    const { clearProjectRootCache, findProjectRoot } = await import(
      `./project-root-finder.ts?memoization=${Date.now()}-${Math.random()}`
    );

    // when
    const firstResult = findProjectRoot(startPath);
    unlinkSync(packageJsonPath);
    const secondResult = findProjectRoot(startPath);
    clearProjectRootCache();
    const thirdResult = findProjectRoot(startPath);

    // then
    expect(firstResult).toBe(projectRoot);
    expect(secondResult).toBe(projectRoot);
    expect(thirdResult).toBeNull();
  });
});
