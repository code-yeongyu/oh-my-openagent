import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function createImportSuffix(): string {
  return `?test=${Date.now()}-${Math.random()}`;
}

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

  it("reuses cached ancestor project root for sibling start paths", async () => {
    // given
    testRoot = join(tmpdir(), `rules-project-root-sibling-${Date.now()}-${Math.random()}`);
    const projectRoot = join(testRoot, "project");
    const siblingDirA = join(projectRoot, "src", "alpha");
    const siblingDirB = join(projectRoot, "src", "beta");
    const siblingFileA = join(siblingDirA, "a.ts");
    const siblingFileB = join(siblingDirB, "b.ts");
    const packageJsonPath = join(projectRoot, "package.json");
    mkdirSync(siblingDirA, { recursive: true });
    mkdirSync(siblingDirB, { recursive: true });
    writeFileSync(siblingFileA, "export const a = 1;\n");
    writeFileSync(siblingFileB, "export const b = 2;\n");
    writeFileSync(packageJsonPath, "{}\n");

    const { clearProjectRootCache, findProjectRoot } = await import(
      `./project-root-finder.ts${createImportSuffix()}`
    );
    clearProjectRootCache();

    // when
    const firstResult = findProjectRoot(siblingFileA);
    unlinkSync(packageJsonPath);
    const siblingResult = findProjectRoot(siblingFileB);

    // then
    expect(firstResult).toBe(projectRoot);
    expect(siblingResult).toBe(projectRoot);
  });
});
