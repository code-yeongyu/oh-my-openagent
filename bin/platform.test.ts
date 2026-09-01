// bin/platform.test.ts
import { describe, expect, test } from "bun:test";
import {
  getBinaryPath,
  getPackageBareName,
  getPlatformPackage,
  getPlatformPackageCandidates,
  resolvePlatformPackageBaseName,
} from "./platform.js";

describe("getPackageBareName", () => {
  test("strips npm scope from package name", () => {
    // #given
    const packageName = "@code-yeongyu/lazycodex";

    // #when
    const bareName = getPackageBareName(packageName);

    // #then
    expect(bareName).toBe("lazycodex");
  });
});

describe("resolvePlatformPackageBaseName", () => {
  test("maps lazycodex wrapper to oh-my-openagent platform package family", () => {
    // #given
    const wrapperPackageName = "lazycodex";

    // #when
    const resolvedPlatformBase = resolvePlatformPackageBaseName(wrapperPackageName);

    // #then
    expect(resolvedPlatformBase).toBe("oh-my-openagent");
  });

  test("maps scoped lazycodex wrapper to oh-my-openagent platform package family", () => {
    // #given
    const wrapperPackageName = "@code-yeongyu/lazycodex";

    // #when
    const resolvedPlatformBase = resolvePlatformPackageBaseName(wrapperPackageName);

    // #then
    expect(resolvedPlatformBase).toBe("oh-my-openagent");
  });

  test("maps lazycodex-ai wrapper to oh-my-openagent platform package family", () => {
    // #given
    const wrapperPackageName = "lazycodex-ai";

    // #when
    const resolvedPlatformBase = resolvePlatformPackageBaseName(wrapperPackageName);

    // #then
    expect(resolvedPlatformBase).toBe("oh-my-openagent");
  });

  test("maps scoped lazycodex-ai wrapper to oh-my-openagent platform package family", () => {
    // #given
    const wrapperPackageName = "@code-yeongyu/lazycodex-ai";

    // #when
    const resolvedPlatformBase = resolvePlatformPackageBaseName(wrapperPackageName);

    // #then
    expect(resolvedPlatformBase).toBe("oh-my-openagent");
  });

  test("keeps oh-my-opencode wrapper mapped to oh-my-opencode platform package family", () => {
    // #given
    const wrapperPackageName = "oh-my-opencode";

    // #when
    const resolvedPlatformBase = resolvePlatformPackageBaseName(wrapperPackageName);

    // #then
    expect(resolvedPlatformBase).toBe("oh-my-opencode");
  });

  test("keeps oh-my-openagent wrapper mapped to oh-my-openagent platform package family", () => {
    // #given
    const wrapperPackageName = "oh-my-openagent";

    // #when
    const resolvedPlatformBase = resolvePlatformPackageBaseName(wrapperPackageName);

    // #then
    expect(resolvedPlatformBase).toBe("oh-my-openagent");
  });
});

describe("getPlatformPackage", () => {
  // #region Darwin platforms
  test("returns darwin-arm64 for macOS ARM64", () => {
    // #given macOS ARM64 platform
    const input = { platform: "darwin", arch: "arm64" };

    // #when getting platform package
    const result = getPlatformPackage(input);

    // #then returns correct package name
    expect(result).toBe("oh-my-opencode-darwin-arm64");
  });

  test("returns darwin-x64 for macOS Intel", () => {
    // #given macOS x64 platform
    const input = { platform: "darwin", arch: "x64" };

    // #when getting platform package
    const result = getPlatformPackage(input);

    // #then returns correct package name
    expect(result).toBe("oh-my-opencode-darwin-x64");
  });
  // #endregion

  // #region Linux glibc platforms
  test("returns linux-x64 for Linux x64 with glibc", () => {
    // #given Linux x64 with glibc
    const input = { platform: "linux", arch: "x64", libcFamily: "glibc" };

    // #when getting platform package
    const result = getPlatformPackage(input);

    // #then returns correct package name
    expect(result).toBe("oh-my-opencode-linux-x64");
  });

  test("returns linux-arm64 for Linux ARM64 with glibc", () => {
    // #given Linux ARM64 with glibc
    const input = { platform: "linux", arch: "arm64", libcFamily: "glibc" };

    // #when getting platform package
    const result = getPlatformPackage(input);

    // #then returns correct package name
    expect(result).toBe("oh-my-opencode-linux-arm64");
  });
  // #endregion

  // #region Linux musl platforms
  test("returns linux-x64-musl for Alpine x64", () => {
    // #given Linux x64 with musl (Alpine)
    const input = { platform: "linux", arch: "x64", libcFamily: "musl" };

    // #when getting platform package
    const result = getPlatformPackage(input);

    // #then returns correct package name with musl suffix
    expect(result).toBe("oh-my-opencode-linux-x64-musl");
  });

  test("returns linux-arm64-musl for Alpine ARM64", () => {
    // #given Linux ARM64 with musl (Alpine)
    const input = { platform: "linux", arch: "arm64", libcFamily: "musl" };

    // #when getting platform package
    const result = getPlatformPackage(input);

    // #then returns correct package name with musl suffix
    expect(result).toBe("oh-my-opencode-linux-arm64-musl");
  });
  // #endregion

  // #region Windows platform
  test("returns windows-x64 for Windows", () => {
    // #given Windows x64 platform (win32 is Node's platform name)
    const input = { platform: "win32", arch: "x64" };

    // #when getting platform package
    const result = getPlatformPackage(input);

    // #then returns correct package name with 'windows' not 'win32'
    expect(result).toBe("oh-my-opencode-windows-x64");
  });
  // #endregion

  // #region Error cases
  test("throws error for Linux with null libcFamily", () => {
    // #given Linux platform with null libc detection
    const input = { platform: "linux", arch: "x64", libcFamily: null };

    // #when getting platform package
    // #then throws descriptive error
    expect(() => getPlatformPackage(input)).toThrow("Could not detect libc");
  });

  test("throws error for Linux with undefined libcFamily", () => {
    // #given Linux platform with undefined libc
    const input = { platform: "linux", arch: "x64", libcFamily: undefined };

    // #when getting platform package
    // #then throws descriptive error
    expect(() => getPlatformPackage(input)).toThrow("Could not detect libc");
  });
  // #endregion
});

describe("getBinaryPath", () => {
  test("returns JavaScript launcher path for Unix platforms", () => {
    // #given Unix platform package
    const pkg = "oh-my-opencode-darwin-arm64";
    const platform = "darwin";

    // #when getting binary path
    const result = getBinaryPath(pkg, platform);

    // #then returns the platform launcher script
    expect(result).toBe("oh-my-opencode-darwin-arm64/bin/oh-my-opencode.js");
  });

  test("returns JavaScript launcher path for Windows", () => {
    // #given Windows platform package
    const pkg = "oh-my-opencode-windows-x64";
    const platform = "win32";

    // #when getting binary path
    const result = getBinaryPath(pkg, platform);

    // #then returns the platform launcher script
    expect(result).toBe("oh-my-opencode-windows-x64/bin/oh-my-opencode.js");
  });

  test("returns JavaScript launcher path for Linux", () => {
    // #given Linux platform package
    const pkg = "oh-my-opencode-linux-x64";
    const platform = "linux";

    // #when getting binary path
    const result = getBinaryPath(pkg, platform);

    // #then returns the platform launcher script
    expect(result).toBe("oh-my-opencode-linux-x64/bin/oh-my-opencode.js");
  });
});

describe("getPlatformPackageCandidates", () => {
  test("returns x64 and baseline candidates for Linux glibc", () => {
    // #given Linux x64 with glibc
    const input = { platform: "linux", arch: "x64", libcFamily: "glibc" };

    // #when getting package candidates
    const result = getPlatformPackageCandidates(input);

    // #then returns modern first then baseline fallback
    expect(result).toEqual([
      "oh-my-opencode-linux-x64",
      "oh-my-opencode-linux-x64-baseline",
    ]);
  });

  test("returns x64 musl and baseline candidates for Linux musl", () => {
    // #given Linux x64 with musl
    const input = { platform: "linux", arch: "x64", libcFamily: "musl" };

    // #when getting package candidates
    const result = getPlatformPackageCandidates(input);

    // #then returns musl modern first then musl baseline fallback
    expect(result).toEqual([
      "oh-my-opencode-linux-x64-musl",
      "oh-my-opencode-linux-x64-musl-baseline",
    ]);
  });

  test("returns baseline first when preferBaseline is true", () => {
    // #given Windows x64 and baseline preference
    const input = { platform: "win32", arch: "x64", preferBaseline: true };

    // #when getting package candidates
    const result = getPlatformPackageCandidates(input);

    // #then baseline package is preferred first
    expect(result).toEqual([
      "oh-my-opencode-windows-x64-baseline",
      "oh-my-opencode-windows-x64",
    ]);
  });



  test("supports renamed package family via packageBaseName override", () => {
    // #given Linux x64 with glibc and renamed package base
    const input = { platform: "linux", arch: "x64", libcFamily: "glibc", packageBaseName: "oh-my-openagent" };

    // #when getting package candidates
    const result = getPlatformPackageCandidates(input);

    // #then returns renamed package family candidates
    expect(result).toEqual([
      "oh-my-openagent-linux-x64",
      "oh-my-openagent-linux-x64-baseline",
    ]);
  });
  test("returns only one candidate for ARM64", () => {
    // #given non-x64 platform
    const input = { platform: "linux", arch: "arm64", libcFamily: "glibc" };

    // #when getting package candidates
    const result = getPlatformPackageCandidates(input);

    // #then baseline fallback is not included
    expect(result).toEqual(["oh-my-opencode-linux-arm64"]);
  });

  test("returns arm64 and x64-baseline candidates for Windows ARM64", () => {
    // #given Windows arm64
    const input = { platform: "win32", arch: "arm64" };

    // #when getting package candidates
    const result = getPlatformPackageCandidates(input);

    // #then arm64 package first then the x64 baseline fallback
    expect(result).toEqual([
      "oh-my-opencode-windows-arm64",
      "oh-my-opencode-windows-x64-baseline",
    ]);
  });

  test("supports renamed package family for Windows ARM64 via packageBaseName override", () => {
    // #given Windows arm64 with renamed package base
    const input = { platform: "win32", arch: "arm64", packageBaseName: "oh-my-openagent" };

    // #when getting package candidates
    const result = getPlatformPackageCandidates(input);

    // #then returns renamed arm64 and x64 baseline candidates
    expect(result).toEqual([
      "oh-my-openagent-windows-arm64",
      "oh-my-openagent-windows-x64-baseline",
    ]);
  });

  test("returns x64 and baseline candidates for Windows x64", () => {
    // #given Windows x64
    const input = { platform: "win32", arch: "x64" };

    // #when getting package candidates
    const result = getPlatformPackageCandidates(input);

    // #then modern x64 first then x64 baseline
    expect(result).toEqual([
      "oh-my-opencode-windows-x64",
      "oh-my-opencode-windows-x64-baseline",
    ]);
  });

  test("returns baseline first for Windows x64 when preferBaseline is true", () => {
    // #given Windows x64 with baseline preference
    const input = { platform: "win32", arch: "x64", preferBaseline: true };

    // #when getting package candidates
    const result = getPlatformPackageCandidates(input);

    // #then baseline package is preferred first
    expect(result).toEqual([
      "oh-my-opencode-windows-x64-baseline",
      "oh-my-opencode-windows-x64",
    ]);
  });
});
