import { describe, expect, test } from "bun:test";

const rootBunfig = new URL("../../../bunfig.toml", import.meta.url);
const requiredPathIgnorePatterns = ["packages/omo-pi/vendor/**", "packages/omo-pi/test-dist/**"];

function readPathIgnorePatterns(contents: string): string[] {
  const match = contents.match(/pathIgnorePatterns\s*=\s*\[([^\]]*)\]/m);
  expect(match).not.toBeNull();
  return Array.from(match?.[1].matchAll(/"([^"]+)"/g) ?? [], (entry) => entry[1]);
}

describe("root Bun test fence", () => {
  test("ignores vendored and generated omo-pi trees", async () => {
    const bunfig = await Bun.file(rootBunfig).text();
    const pathIgnorePatterns = readPathIgnorePatterns(bunfig);

    for (const pattern of requiredPathIgnorePatterns) {
      expect(pathIgnorePatterns).toContain(pattern);
    }

    expect(pathIgnorePatterns).not.toContain("packages/omo-pi/**");
  });
});
