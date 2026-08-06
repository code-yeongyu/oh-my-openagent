import { describe, expect, it } from "bun:test";
import { normalizeMatch, normalizeRecords } from "./normalize";

const workdir = "/workspace/project";

function record(file: string, byteOffset: number, text = "console.log(a, b)") {
  return {
    text,
    range: {
      byteOffset: { start: byteOffset, end: byteOffset + Buffer.byteLength(text) },
      start: { line: 2, column: 4 },
      end: { line: 2, column: 4 + text.length },
    },
    file,
    lines: `${text};`,
    language: "TypeScript",
    metaVariables: {
      single: {
        CALLEE: {
          text: "console.log",
          range: {
            byteOffset: { start: byteOffset, end: byteOffset + 11 },
            start: { line: 2, column: 4 },
            end: { line: 2, column: 15 },
          },
        },
      },
      multi: {
        ARGS: [
          { text: "a", range: { byteOffset: { start: byteOffset + 12, end: byteOffset + 13 } } },
          { text: ",", range: { byteOffset: { start: byteOffset + 13, end: byteOffset + 14 } } },
          { text: "b", range: { byteOffset: { start: byteOffset + 15, end: byteOffset + 16 } } },
        ],
        EMPTY: [],
      },
      transformed: {},
    },
    replacement: "logger.info(a, b)",
    ruleId: "no-console",
  };
}

describe("ast-grep output normalization", () => {
  it("#given a pinned run record #when normalized #then coordinates, paths, and metavariables use the stable contract", () => {
    const normalized = normalizeMatch(record("/workspace/project/src/a.ts", 100), workdir);

    expect(normalized).toEqual({
      path: "src/a.ts",
      language: "typescript",
      text: "console.log(a, b)",
      range: {
        start: { line: 3, column: 4, byteOffset: 100 },
        end: { line: 3, column: 21, byteOffset: 117 },
      },
      metavariables: {
        single: { CALLEE: "console.log" },
        multi: { ARGS: "a, b", EMPTY: "" },
      },
      replacement: "logger.info(a, b)",
      ruleId: "no-console",
    });
  });

  it("#given inside, outside, and Windows paths #when normalized #then separators and containment are stable", () => {
    expect(normalizeMatch(record("/other/a.ts", 0), workdir).path).toBe("/other/a.ts");
    expect(normalizeMatch(record("C:\\repo\\src\\a.ts", 0), "C:\\repo").path).toBe("src/a.ts");
    expect(normalizeMatch(record("D:\\other\\a.ts", 0), "C:\\repo").path).toBe("D:/other/a.ts");
  });

  it("#given unsorted records #when normalized #then results sort by path and byte offset", () => {
    const normalized = normalizeRecords([
      record("/workspace/project/z.ts", 1),
      record("/workspace/project/a.ts", 20),
      record("/workspace/project/a.ts", 3),
    ], workdir);

    expect(normalized.map((match) => [match.path, match.range.start.byteOffset])).toEqual([
      ["a.ts", 3],
      ["a.ts", 20],
      ["z.ts", 1],
    ]);
  });

  it("#given multibyte source #when a multi capture is collapsed #then sg byte offsets select contiguous UTF-8 text", () => {
    const raw = record("/workspace/project/a.ts", 10, "call(α, β)");
    raw.metaVariables.multi.ARGS = [
      { text: "α", range: { byteOffset: { start: 15, end: 17 } } },
      { text: ",", range: { byteOffset: { start: 17, end: 18 } } },
      { text: "β", range: { byteOffset: { start: 19, end: 21 } } },
    ];

    expect(normalizeMatch(raw, workdir).metavariables.multi.ARGS).toBe("α, β");
  });
});
