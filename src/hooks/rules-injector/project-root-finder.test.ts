import { afterEach, describe, expect, it, mock } from "bun:test";

describe("findProjectRoot", () => {
  afterEach(async () => {
    const actualFileSystem = await import("node:fs");
    mock.module("node:fs", () => actualFileSystem);
  });

  it("memoizes repeated lookups for the same start path and resets on cache clear", async () => {
    // given
    const actualFileSystem = await import("node:fs");
    const projectRoot = "/workspace/project";
    const startPath = `${projectRoot}/src/file.ts`;
    const packageJsonPath = `${projectRoot}/package.json`;

    const existsSyncSpy = mock((path: string) => path === packageJsonPath);
    const statSyncSpy = mock(() => ({ isDirectory: () => false }));

    mock.module("node:fs", () => ({
      ...actualFileSystem,
      existsSync: existsSyncSpy,
      statSync: statSyncSpy,
    }));

    const { clearProjectRootCache, findProjectRoot } = await import(
      `./project-root-finder.ts?memoization=${Date.now()}`
    );

    // when
    const firstResult = findProjectRoot(startPath);
    const firstExistsSyncCallCount = existsSyncSpy.mock.calls.length;

    const secondResult = findProjectRoot(startPath);
    const secondExistsSyncCallCount = existsSyncSpy.mock.calls.length;

    clearProjectRootCache();
    const thirdResult = findProjectRoot(startPath);

    // then
    expect(firstResult).toBe(projectRoot);
    expect(secondResult).toBe(projectRoot);
    expect(thirdResult).toBe(projectRoot);
    expect(firstExistsSyncCallCount).toBeGreaterThan(0);
    expect(secondExistsSyncCallCount).toBe(firstExistsSyncCallCount);
    expect(existsSyncSpy).toHaveBeenCalledTimes(firstExistsSyncCallCount * 2);
  });
});
