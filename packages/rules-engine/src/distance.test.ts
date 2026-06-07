import { describe, expect, it } from "bun:test";

import { GLOBAL_DISTANCE } from "./constants";
import { calculateDistance } from "./distance";

describe("calculateDistance", () => {
  it("#given no project root #when calculating rule distance #then returns the global distance", () => {
    // given
    const rulePath = "/repo/.omo/rules/rule.md";
    const currentFile = "/repo/src/index.ts";

    // when
    const distance = calculateDistance(rulePath, currentFile, null);

    // then
    expect(distance).toBe(GLOBAL_DISTANCE);
  });

  it("#given rule and current file share a directory #when calculating rule distance #then returns zero", () => {
    // given
    const projectRoot = "/repo";
    const rulePath = "/repo/src/rule.md";
    const currentFile = "/repo/src/index.ts";

    // when
    const distance = calculateDistance(rulePath, currentFile, projectRoot);

    // then
    expect(distance).toBe(0);
  });

  it("#given the current file is nested below the rule directory #when calculating rule distance #then counts unmatched current path segments", () => {
    // given
    const projectRoot = "/repo";
    const rulePath = "/repo/src/rule.md";
    const currentFile = "/repo/src/features/search/index.ts";

    // when
    const distance = calculateDistance(rulePath, currentFile, projectRoot);

    // then
    expect(distance).toBe(2);
  });

  it("#given rule and current file are in sibling project directories #when calculating rule distance #then counts from the current file directory", () => {
    // given
    const projectRoot = "/repo";
    const rulePath = "/repo/packages/rules/.omo/rules/rule.md";
    const currentFile = "/repo/packages/app/src/index.ts";

    // when
    const distance = calculateDistance(rulePath, currentFile, projectRoot);

    // then
    expect(distance).toBe(2);
  });

  it("#given the current file is outside the project #when calculating rule distance #then returns the global distance", () => {
    // given
    const projectRoot = "/repo";
    const rulePath = "/repo/.omo/rules/rule.md";
    const currentFile = "/external/src/index.ts";

    // when
    const distance = calculateDistance(rulePath, currentFile, projectRoot);

    // then
    expect(distance).toBe(GLOBAL_DISTANCE);
  });

  it("#given Windows-style paths #when calculating rule distance #then uses Windows path semantics", () => {
    // given
    const projectRoot = "C:\\repo";
    const rulePath = "C:\\repo\\.omo\\rules\\rule.md";
    const currentFile = "C:\\repo\\src\\index.ts";

    // when
    const distance = calculateDistance(rulePath, currentFile, projectRoot);

    // then
    expect(distance).toBe(1);
  });

  it("#given a Windows rule path on another drive #when calculating rule distance #then returns the global distance", () => {
    // given
    const projectRoot = "C:\\repo";
    const rulePath = "D:\\rules\\rule.md";
    const currentFile = "C:\\repo\\src\\index.ts";

    // when
    const distance = calculateDistance(rulePath, currentFile, projectRoot);

    // then
    expect(distance).toBe(GLOBAL_DISTANCE);
  });

  it("#given a Windows current file on another drive #when calculating rule distance #then returns the global distance", () => {
    // given
    const projectRoot = "C:\\repo";
    const rulePath = "C:\\repo\\.omo\\rules\\rule.md";
    const currentFile = "D:\\repo\\src\\index.ts";

    // when
    const distance = calculateDistance(rulePath, currentFile, projectRoot);

    // then
    expect(distance).toBe(GLOBAL_DISTANCE);
  });

  it("#given a UNC current file on another server and share #when calculating rule distance #then returns the global distance", () => {
    // given
    const projectRoot = "\\\\server-a\\share-a\\repo";
    const rulePath = "\\\\server-a\\share-a\\repo\\.omo\\rules\\rule.md";
    const currentFile = "\\\\server-b\\share-b\\repo\\src\\index.ts";

    // when
    const distance = calculateDistance(rulePath, currentFile, projectRoot);

    // then
    expect(distance).toBe(GLOBAL_DISTANCE);
  });
});
