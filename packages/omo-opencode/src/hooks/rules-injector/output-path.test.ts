import { describe, expect, it } from "bun:test";
import { getRuleInjectionFilePath } from "./output-path";

describe("getRuleInjectionFilePath", () => {
  it("prefers metadata filePath when available", () => {
    // given
    const output = {
      title: "read file",
      metadata: { filePath: "/project/src/app.ts" },
    };

    // when
    const result = getRuleInjectionFilePath(output);

    // then
    expect(result).toBe("/project/src/app.ts");
  });

  it("falls back to title when metadata filePath is missing", () => {
    // given
    const output = {
      title: "src/app.ts",
      metadata: {},
    };

    // when
    const result = getRuleInjectionFilePath(output);

    // then
    expect(result).toBe("src/app.ts");
  });

  it("returns null when both title and metadata are empty", () => {
    // given
    const output = {
      title: "",
      metadata: null,
    };

    // when
    const result = getRuleInjectionFilePath(output);

    // then
    expect(result).toBeNull();
  });
});
