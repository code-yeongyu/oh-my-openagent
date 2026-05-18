/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { DEFAULTS, KEYWORD_DETECTORS } from "./constants";
import { detectKeywordsWithType } from "./detector";

describe("keyword-detector defaults.jsonc loading", () => {
  test("should load all 4 static patterns from defaults.jsonc", () => {
    expect(DEFAULTS.patterns.size).toBe(4);
    expect(DEFAULTS.patterns.has("search")).toBe(true);
    expect(DEFAULTS.patterns.has("analyze")).toBe(true);
    expect(DEFAULTS.patterns.has("team")).toBe(true);
    expect(DEFAULTS.patterns.has("hyperplan")).toBe(true);
  });

  test("should load all 4 static messages from defaults.jsonc", () => {
    expect(DEFAULTS.messages.size).toBe(4);
    expect(DEFAULTS.messages.get("search")).toContain("[search-mode]");
    expect(DEFAULTS.messages.get("analyze")).toContain("[analyze-mode]");
    expect(DEFAULTS.messages.get("team")).toContain("[team-mode]");
    expect(DEFAULTS.messages.get("hyperplan")).toContain("<hyperplan-mode>");
  });

  test("should have 6 entries in KEYWORD_DETECTORS", () => {
    expect(KEYWORD_DETECTORS.length).toBe(6);
    const types = KEYWORD_DETECTORS.map((d) => d.type);
    expect(types).toContain("ultrawork");
    expect(types).toContain("search");
    expect(types).toContain("analyze");
    expect(types).toContain("team");
    expect(types).toContain("hyperplan");
    expect(types).toContain("hyperplan-ultrawork");
  });
});

describe("keyword-detector modes.pattern_append", () => {
  test("should append trigger words to search pattern", () => {
    const result = detectKeywordsWithType(
      "please customword this code",
      undefined,
      undefined,
      undefined,
      { search: { pattern_append: "|customword" } },
    );
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("search");
  });

  test("should detect custom keyword that default pattern misses", () => {
    const result = detectKeywordsWithType(
      "testword for the bug",
      undefined,
      undefined,
      undefined,
      { search: { pattern_append: "|testword" } },
    );
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("search");
  });

  test("should still detect default keywords after pattern_append", () => {
    const result = detectKeywordsWithType(
      "search for the bug",
      undefined,
      undefined,
      undefined,
      { search: { pattern_append: "|customword" } },
    );
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("search");
  });

  test("should fallback to default pattern on invalid regex", () => {
    const warnCalls: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnCalls.push(msg);

    const result = detectKeywordsWithType(
      "search for the bug",
      undefined,
      undefined,
      undefined,
      { search: { pattern_append: "[invalid" } },
    );

    console.warn = originalWarn;
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("search");
    expect(warnCalls.some((w) => w.includes("Invalid pattern_append"))).toBe(
      true,
    );
  });

  test("should not affect other modes when only search has pattern_append", () => {
    const result = detectKeywordsWithType(
      "investigate and search",
      undefined,
      undefined,
      undefined,
      { search: { pattern_append: "|lookup" } },
    );
    const types = result.map((r) => r.type);
    expect(types).toContain("search");
    expect(types).toContain("analyze");
  });
});

describe("keyword-detector modes.message_append", () => {
  test("should not append undefined message_append values", () => {
    // given
    // when
    const result = detectKeywordsWithType(
      "search for the bug",
      undefined,
      undefined,
      undefined,
      { search: { message_append: undefined } },
    );

    // then
    expect(result.length).toBe(1);
    expect(result[0].message).toContain("[search-mode]");
    expect(result[0].message).not.toContain("undefined");
  });

  test("should append text to search message", () => {
    const result = detectKeywordsWithType(
      "search for the bug",
      undefined,
      undefined,
      undefined,
      { search: { message_append: "\n\nAlso use tavily_search." } },
    );
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("search");
    expect(result[0].message).toContain("[search-mode]");
    expect(result[0].message).toContain("Also use tavily_search.");
  });

  test("should append text to analyze message", () => {
    const result = detectKeywordsWithType(
      "investigate this",
      undefined,
      undefined,
      undefined,
      { analyze: { message_append: "\n\nCustom analysis note." } },
    );
    expect(result.length).toBe(1);
    expect(result[0].message).toContain("[analyze-mode]");
    expect(result[0].message).toContain("Custom analysis note.");
  });

  test("should not affect other modes when only search has message_append", () => {
    const result = detectKeywordsWithType(
      "search and investigate",
      undefined,
      undefined,
      undefined,
      { search: { message_append: "\n\nCustom." } },
    );
    const searchResult = result.find((r) => r.type === "search");
    const analyzeResult = result.find((r) => r.type === "analyze");
    expect(searchResult!.message).toContain("Custom.");
    expect(analyzeResult!.message).not.toContain("Custom.");
  });
});

describe("keyword-detector modes.message override", () => {
  test("should fully replace search message", () => {
    const result = detectKeywordsWithType(
      "search for the bug",
      undefined,
      undefined,
      undefined,
      { search: { message: "[custom-search] Use ace_search_context." } },
    );
    expect(result.length).toBe(1);
    expect(result[0].message).toBe("[custom-search] Use ace_search_context.");
    expect(result[0].message).not.toContain("[search-mode]");
  });

  test("should take precedence over message_append when both set", () => {
    const result = detectKeywordsWithType(
      "search for the bug",
      undefined,
      undefined,
      undefined,
      {
        search: {
          message: "[custom] Override.",
          message_append: "\n\nThis should be ignored.",
        },
      },
    );
    expect(result[0].message).toBe("[custom] Override.");
    expect(result[0].message).not.toContain("This should be ignored.");
  });
});

describe("keyword-detector dynamic modes ignore config", () => {
  test("should ignore message config for ultrawork", () => {
    const result = detectKeywordsWithType(
      "ultrawork do this",
      "sisyphus",
      undefined,
      undefined,
      { ultrawork: { message: "custom ultrawork" } },
    );
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("ultrawork");
    expect(result[0].message).not.toBe("custom ultrawork");
    expect(result[0].message).toContain(
      "YOU MUST LEVERAGE ALL AVAILABLE AGENTS",
    );
  });

  test("should ignore message_append config for ultrawork", () => {
    const result = detectKeywordsWithType(
      "ultrawork do this",
      "sisyphus",
      undefined,
      undefined,
      { ultrawork: { message_append: "\n\nCustom append." } },
    );
    expect(result.length).toBe(1);
    expect(result[0].message).not.toContain("Custom append.");
  });

  test("should ignore message config for hyperplan-ultrawork", () => {
    const result = detectKeywordsWithType(
      "hpp ultrawork",
      "sisyphus",
      undefined,
      undefined,
      { "hyperplan-ultrawork": { message: "custom combo" } },
    );
    const comboResult = result.find((r) => r.type === "hyperplan-ultrawork");
    expect(comboResult).toBeDefined();
    expect(comboResult!.message).not.toBe("custom combo");
    expect(comboResult!.message).toContain("HYPERPLAN ULTRAWORK MODE ENABLED");
  });

  test("should apply pattern_append for ultrawork", () => {
    const result = detectKeywordsWithType(
      "ulw-custom do this",
      "sisyphus",
      undefined,
      undefined,
      { ultrawork: { pattern_append: "-custom" } },
    );
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("ultrawork");
  });
});

describe("keyword-detector backward compatibility", () => {
  test("should behave identically when modes is undefined", () => {
    const withoutModes = detectKeywordsWithType("search for bug");
    const withUndefined = detectKeywordsWithType(
      "search for bug",
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(withoutModes).toEqual(withUndefined);
  });

  test("should behave identically when modes is empty object", () => {
    const withoutModes = detectKeywordsWithType("search for bug");
    const withEmpty = detectKeywordsWithType(
      "search for bug",
      undefined,
      undefined,
      undefined,
      {},
    );
    expect(withoutModes).toEqual(withEmpty);
  });

  test("should still respect disabled_keywords with modes", () => {
    const result = detectKeywordsWithType(
      "search and investigate",
      undefined,
      undefined,
      ["search"],
      { search: { message_append: "\n\nCustom." } },
    );
    const types = result.map((r) => r.type);
    expect(types).not.toContain("search");
    expect(types).toContain("analyze");
  });
});
