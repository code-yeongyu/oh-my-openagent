import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type PackageJson = {
  readonly name: string;
  readonly type: string;
  readonly bin: Record<string, string>;
};

function readPackageJson(path: string): PackageJson {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isPackageJson(parsed)) throw new TypeError(`Invalid package metadata: ${path}`);
  return parsed;
}

describe("package metadata", () => {
  it("#given packaged ast-grep MCP files #when validating entrypoints #then package metadata exposes the omo CLI", () => {
    // given
    const packageJson = readPackageJson(fileURLToPath(new URL("../package.json", import.meta.url)));
    const cliSource = readFileSync(fileURLToPath(new URL("cli.ts", import.meta.url)), "utf8");

    // then
    expect(packageJson.name).toBe("@oh-my-opencode/ast-grep-mcp");
    expect(packageJson.type).toBe("module");
    expect(packageJson.bin["omo-ast-grep"]).toBe("dist/cli.js");
    expect(packageJson.bin["ast-grep-mcp"]).toBeUndefined();
    expect(cliSource.startsWith("#!/usr/bin/env node")).toBe(true);
    expect(cliSource).toContain("Usage: omo-ast-grep [mcp]");
  });
});

function isPackageJson(value: unknown): value is PackageJson {
  return (
    isRecord(value) &&
    value["name"] === "@oh-my-opencode/ast-grep-mcp" &&
    value["type"] === "module" &&
    isStringRecord(value["bin"])
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
