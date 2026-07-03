import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const vendorRoot = join(packageRoot, "vendor");

async function walk(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    paths.push(path);
    if (entry.isDirectory()) {
      paths.push(...(await walk(path)));
    }
  }
  return paths;
}

describe("vendored senpi tree", () => {
  test("records a pinned senpi SHA", async () => {
    const shaPath = join(vendorRoot, "SENPI_SHA");
    expect(existsSync(shaPath)).toBe(true);
    const sha = await Bun.file(shaPath).text();
    expect(sha.trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  test("contains the coding-agent config source", () => {
    expect(existsSync(join(vendorRoot, "coding-agent", "src", "config.ts"))).toBe(true);
  });

  test("excludes test files and node_modules", async () => {
    const paths = await walk(vendorRoot);
    const relativePaths = paths.map((path) => relative(packageRoot, path));
    expect(relativePaths.filter((path) => path.endsWith(".test.ts"))).toEqual([]);
    expect(relativePaths.filter((path) => path.split(/[\\/]/).includes("node_modules"))).toEqual([]);
  });

  test("does not create a top-level plugin directory", () => {
    expect(existsSync(join(packageRoot, "plugin"))).toBe(false);
  });
});
