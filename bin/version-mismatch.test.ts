// bin/version-mismatch.test.ts
import { describe, expect, test } from "bun:test";
import { detectPlatformBinaryMismatch } from "./version-mismatch.js";

describe("detectPlatformBinaryMismatch", () => {
  test("returns null when main and platform versions match", () => {
    // #given identical main and platform binary versions
    const input = { mainVersion: "4.5.1", platformVersion: "4.5.1", platformPackage: "oh-my-opencode-windows-x64" };

    // #when detecting mismatch
    const result = detectPlatformBinaryMismatch(input);

    // #then no mismatch is reported
    expect(result).toBeNull();
  });

  test("reports mismatch when platform version is older than main", () => {
    // #given main package newer than installed platform binary (issue #3918 case)
    const input = { mainVersion: "4.5.1", platformVersion: "3.9.0", platformPackage: "oh-my-opencode-windows-x64" };

    // #when detecting mismatch
    const result = detectPlatformBinaryMismatch(input);

    // #then mismatch object is returned with both versions
    expect(result).toEqual({
      mainVersion: "4.5.1",
      platformVersion: "3.9.0",
      platformPackage: "oh-my-opencode-windows-x64",
    });
  });

  test("reports mismatch when platform version is newer than main", () => {
    // #given platform binary newer than main wrapper
    const input = { mainVersion: "4.0.0", platformVersion: "4.5.1", platformPackage: "oh-my-opencode-linux-x64" };

    // #when detecting mismatch
    const result = detectPlatformBinaryMismatch(input);

    // #then mismatch is still reported (any difference is a mismatch)
    expect(result).not.toBeNull();
    expect(result?.platformVersion).toBe("4.5.1");
  });

  test("returns null when main version is unknown", () => {
    // #given main version could not be read
    const input = { mainVersion: null, platformVersion: "4.5.1", platformPackage: "oh-my-opencode-windows-x64" };

    // #when detecting mismatch
    const result = detectPlatformBinaryMismatch(input);

    // #then no mismatch is reported - cannot compare without main version
    expect(result).toBeNull();
  });

  test("returns null when platform version is unknown", () => {
    // #given platform package.json could not be read
    const input = { mainVersion: "4.5.1", platformVersion: null, platformPackage: "oh-my-opencode-windows-x64" };

    // #when detecting mismatch
    const result = detectPlatformBinaryMismatch(input);

    // #then no mismatch is reported - silently skip rather than alarm
    expect(result).toBeNull();
  });

  test("ignores pre-release suffixes when comparing equal versions", () => {
    // #given identical core versions differing only by build metadata suffix
    const input = { mainVersion: "4.5.1-beta.1", platformVersion: "4.5.1", platformPackage: "oh-my-opencode-darwin-arm64" };

    // #when detecting mismatch
    const result = detectPlatformBinaryMismatch(input);

    // #then versions are treated as equivalent
    expect(result).toBeNull();
  });
});
