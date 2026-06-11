// bin/opencode-cache.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isExactVersion, refreshOpenCodePluginCache } from "./opencode-cache.js";

const PACKAGE_NAMES = ["oh-my-opencode", "oh-my-openagent"];

let cacheDir: string;

function makeSpecDir(parent: string, name: string): string {
  const specPath = join(parent, name);
  mkdirSync(join(specPath, "node_modules"), { recursive: true });
  writeFileSync(join(specPath, "package.json"), JSON.stringify({ dependencies: {} }));
  return specPath;
}

function stubInstall(options: { succeed: boolean }): (input: { directory: string }) => boolean {
  return ({ directory }) => {
    if (!options.succeed) return false;
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    const [name] = Object.keys(manifest.dependencies);
    const version = manifest.dependencies[name];
    const packageDir = join(directory, "node_modules", name);
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name, version }));
    return true;
  };
}

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "omo-opencode-cache-"));
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

describe("isExactVersion", () => {
  test("accepts exact semver pins including prereleases", () => {
    // #given exact version strings
    // #when / #then they are recognised as exact pins
    expect(isExactVersion("4.8.1")).toBe(true);
    expect(isExactVersion("4.8.1-beta.1")).toBe(true);
  });

  test("rejects dist-tags and ranges", () => {
    // #given non-exact specs as they appear in cache dir names
    // #when / #then they are not treated as exact pins
    expect(isExactVersion("latest")).toBe(false);
    expect(isExactVersion("next")).toBe(false);
    expect(isExactVersion("^4.8.0")).toBe(false);
    expect(isExactVersion("4")).toBe(false);
  });
});

describe("refreshOpenCodePluginCache", () => {
  test("repopulates a dist-tag spec dir pinned to the installed version", () => {
    // #given a cached oh-my-openagent@latest spec dir in the packages layout
    const packagesDir = join(cacheDir, "packages");
    const specPath = makeSpecDir(packagesDir, "oh-my-openagent@latest");

    // #when refreshing after installing 4.9.0
    const summary = refreshOpenCodePluginCache({
      cacheDir,
      packageNames: PACKAGE_NAMES,
      installedVersion: "4.9.0",
      installDependencies: stubInstall({ succeed: true }),
    });

    // #then the spec dir is rebuilt with a manifest pinning 4.9.0
    expect(summary.refreshed).toEqual([specPath]);
    expect(summary.removed).toEqual([]);
    const manifest = JSON.parse(readFileSync(join(specPath, "package.json"), "utf8"));
    expect(manifest.dependencies["oh-my-openagent"]).toBe("4.9.0");
    expect(existsSync(join(specPath, "node_modules", "oh-my-openagent", "package.json"))).toBe(true);
  });

  test("keeps the pin of an exact-version spec dir", () => {
    // #given a cached spec dir pinned to an older exact version
    const packagesDir = join(cacheDir, "packages");
    const specPath = makeSpecDir(packagesDir, "oh-my-openagent@4.5.0");

    // #when refreshing after installing 4.9.0
    refreshOpenCodePluginCache({
      cacheDir,
      packageNames: PACKAGE_NAMES,
      installedVersion: "4.9.0",
      installDependencies: stubInstall({ succeed: true }),
    });

    // #then the manifest still pins the exact version the user requested
    const manifest = JSON.parse(readFileSync(join(specPath, "package.json"), "utf8"));
    expect(manifest.dependencies["oh-my-openagent"]).toBe("4.5.0");
  });

  test("refreshes the legacy cache layout next to the packages layout", () => {
    // #given spec dirs in both supported cache layouts
    const legacyPath = makeSpecDir(cacheDir, "oh-my-opencode@latest");
    const packagedPath = makeSpecDir(join(cacheDir, "packages"), "oh-my-opencode@latest");

    // #when refreshing
    const summary = refreshOpenCodePluginCache({
      cacheDir,
      packageNames: PACKAGE_NAMES,
      installedVersion: "4.9.0",
      installDependencies: stubInstall({ succeed: true }),
    });

    // #then both layouts are repopulated
    expect(summary.refreshed.sort()).toEqual([legacyPath, packagedPath].sort());
  });

  test("removes the spec dir entirely when dependency install fails", () => {
    // #given a cached spec dir and an installer that fails
    const specPath = makeSpecDir(join(cacheDir, "packages"), "oh-my-openagent@latest");

    // #when refreshing
    const summary = refreshOpenCodePluginCache({
      cacheDir,
      packageNames: PACKAGE_NAMES,
      installedVersion: "4.9.0",
      installDependencies: stubInstall({ succeed: false }),
    });

    // #then the dir is gone so OpenCode sees a clean cold cache, not a broken tree
    expect(summary.refreshed).toEqual([]);
    expect(summary.removed).toEqual([specPath]);
    expect(existsSync(specPath)).toBe(false);
  });

  test("removes the spec dir when the installed version is unknown", () => {
    // #given a dist-tag spec dir but no version information
    const specPath = makeSpecDir(join(cacheDir, "packages"), "oh-my-openagent@latest");

    // #when refreshing without an installed version
    const summary = refreshOpenCodePluginCache({
      cacheDir,
      packageNames: PACKAGE_NAMES,
      installedVersion: null,
      installDependencies: stubInstall({ succeed: true }),
    });

    // #then the previous delete-only behaviour applies
    expect(summary.removed).toEqual([specPath]);
    expect(existsSync(specPath)).toBe(false);
  });

  test("leaves unrelated cached plugins untouched", () => {
    // #given another plugin's spec dir in the cache
    const otherPath = makeSpecDir(join(cacheDir, "packages"), "opencode-pty@latest");
    const sentinel = join(otherPath, "node_modules", "sentinel");
    mkdirSync(sentinel, { recursive: true });

    // #when refreshing oh-my plugin caches
    const summary = refreshOpenCodePluginCache({
      cacheDir,
      packageNames: PACKAGE_NAMES,
      installedVersion: "4.9.0",
      installDependencies: stubInstall({ succeed: true }),
    });

    // #then the unrelated plugin cache is untouched
    expect(summary.refreshed).toEqual([]);
    expect(summary.removed).toEqual([]);
    expect(existsSync(sentinel)).toBe(true);
  });

  test("is a no-op when the cache root does not exist", () => {
    // #given a cache root that was never created
    const missing = join(cacheDir, "does-not-exist");

    // #when refreshing
    const summary = refreshOpenCodePluginCache({
      cacheDir: missing,
      packageNames: PACKAGE_NAMES,
      installedVersion: "4.9.0",
      installDependencies: stubInstall({ succeed: true }),
    });

    // #then nothing is reported and nothing is created
    expect(summary).toEqual({ refreshed: [], removed: [] });
    expect(existsSync(missing)).toBe(false);
  });
});
