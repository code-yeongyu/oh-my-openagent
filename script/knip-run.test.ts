import { describe, expect, test } from "bun:test";
import { debugEntryPaths, toRepoPath, unusedExports } from "./knip-run.ts";

const report = (file: string) => JSON.stringify({ issues: [{ file, exports: [{ name: "probe" }] }] });

describe("knip paths are one repo-relative POSIX form on every platform", () => {
  test.each([
    ["C:\\r", "C:\\r\\x\\y.ts", "x/y.ts"],
    ["C:\\r", "c:/R/x\\y.ts", "x/y.ts"],
    ["C:\\r", "x\\y.ts", "x/y.ts"],
    ["/r", "/r/x/y.ts", "x/y.ts"],
    ["/r", "x/y.ts", "x/y.ts"],
  ])("toRepoPath(%p, %p) is %p", (root, path, expected) => {
    expect(toRepoPath(root, path)).toBe(expected);
  });

  test("unusedExports keys Windows-form report paths in POSIX form", () => {
    expect([...unusedExports("C:\\r", report("C:\\r\\x\\y.ts"), "")]).toEqual(["x/y.ts#probe"]);
    expect([...unusedExports("C:\\r", report("x\\y.ts"), "")]).toEqual(["x/y.ts#probe"]);
  });

  test.each([
    ["one path per line, a ']' inside a path", "paths: [\n    '/r/app/[locale]/layout.tsx',\n    '/r/app/design/page.tsx'\n  ]", ["/r/app/[locale]/layout.tsx", "/r/app/design/page.tsx"]],
    ["inline", "paths: [ '/r/a.ts', '/r/[id]/b.ts' ]", ["/r/a.ts", "/r/[id]/b.ts"]],
    ["empty", "paths: []", []],
    ["escaped Windows separators", "paths: [ 'C:\\\\r\\\\[id]\\\\x.ts' ]", ["C:\\r\\[id]\\x.ts"]],
  ])("debugEntryPaths reads every path of a knip --debug entry section: %s", (_, listing, expected) => {
    const stdout = `[w] Finding entry paths from plugins\n{\n  patterns: [ 'app/**/page.tsx' ],\n  ${listing}\n}\n[w] Finding project paths\n{ paths: [ '/r/other.ts' ] }`;
    expect(debugEntryPaths(stdout)).toEqual([expected]);
  });

  // Every way an entry section can lack its own readable array, alone and followed by a later readable listing:
  // each must fail rather than drop paths or borrow the later section's array.
  test.each([
    ["a truncated array", "{\n  paths: [ '/r/a.ts', ... 3 more items ]\n}"],
    ["no paths key", "{ foo: 1 }"],
    ["an unquoted entry", "{ paths: [ /r/a.ts ] }"],
    ["no object at all", ""],
  ])("debugEntryPaths fails on an entry section with %s", (_, body) => {
    const section = `[w] Finding entry paths\n${body}`;
    expect(() => debugEntryPaths(section)).toThrow("no readable paths array");
    expect(() => debugEntryPaths(`${section}\n[w] Finding project paths\n{ paths: [ '/r/other.ts' ] }`)).toThrow("no readable paths array");
  });

  test("a reported path outside the knip cwd fails instead of silently missing", () => {
    // An 8.3 short cwd against a long-form file path: the two forms of one directory must not pass unnoticed.
    expect(() => unusedExports("C:\\Users\\RUNNER~1\\t", report("C:\\Users\\runneradmin\\t\\x.ts"), "")).toThrow(
      "outside its cwd",
    );
  });
});
