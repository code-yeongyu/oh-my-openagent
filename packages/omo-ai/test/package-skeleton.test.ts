import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../../..");
const packageRoot = join(repositoryRoot, "packages/omo-ai");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonObject(filePath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  if (!isRecord(parsed)) {
    throw new TypeError(`${filePath} must contain a JSON object`);
  }
  return parsed;
}

function requireStringArray(
  record: Record<string, unknown>,
  key: string,
): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new TypeError(`${key} must be a string array`);
  }
  return value;
}

function requireRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw new TypeError(`${key} must be a JSON object`);
  }
  return value;
}

describe("omo-ai package skeleton", () => {
  it("declares the senpi package workspace and manifest when the skeleton is present", () => {
    // Given: the root workspace manifest and the expected senpi adapter package path.
    const rootPackage = readJsonObject(join(repositoryRoot, "package.json"));

    // When: the workspace package manifest is inspected.
    const workspaces = requireStringArray(rootPackage, "workspaces");
    const packageManifest = readJsonObject(join(packageRoot, "package.json"));

    // Then: only the approved package name is added and its npm/pi surfaces are declared.
    expect(workspaces.filter((workspace) => workspace === "packages/omo-ai")).toEqual([
      "packages/omo-ai",
    ]);
    expect(existsSync(join(repositoryRoot, "packages/omo-senpi"))).toBe(false);
    expect(packageManifest["name"]).toBe("omo-ai");
    expect(packageManifest["version"]).toBe("4.15.0");
    expect(packageManifest["type"]).toBe("module");
    expect(requireRecord(packageManifest, "bin")).toEqual({
      "omo-ai": "./src/cli/index.ts",
    });
    expect(requireStringArray(packageManifest, "keywords")).toContain("pi-package");
    expect(requireRecord(packageManifest, "scripts")["postinstall"]).toBe(
      "bun run ./src/install/postinstall.ts",
    );
    expect(requireRecord(packageManifest, "pi")).toEqual({
      hooks: "./senpi/hooks",
      skills: "./senpi/skills",
      prompts: "./senpi/prompts",
      extensions: "./senpi/extensions",
    });
  });

  it("tracks the approved source, senpi, and test directories", () => {
    // Given: the approved skeleton directories for the senpi adapter package.
    const requiredDirectories = [
      "src/cli",
      "src/install",
      "src/doctor",
      "src/senpi-compat",
      "senpi/hooks",
      "senpi/skills",
      "senpi/prompts",
      "senpi/extensions",
      "senpi/components",
      "senpi/docs",
      "senpi/.codex-plugin",
      "test",
    ] as const;

    // When: each required package directory is checked.
    const missingDirectories = requiredDirectories.filter(
      (directory) => !existsSync(join(packageRoot, directory)),
    );

    // Then: the skeleton has a tracked placeholder for every required area.
    expect(missingDirectories).toEqual([]);
  });
});
