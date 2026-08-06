import { describe, expect, it } from "bun:test";
import { resolveGitBash } from "./git-bash-resolver";

const PROGRAM_FILES_GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const PROGRAM_FILES_X86_GIT_BASH = "C:\\Program Files (x86)\\Git\\bin\\bash.exe";

describe("resolveGitBash launcher rejection", () => {
  it("#given PATH bash is only the System32 WSL launcher #when resolving #then launcher is skipped and resolution fails", () => {
    const system32Bash = "C:\\Windows\\System32\\bash.exe";
    const result = resolveGitBash({
      platform: "win32",
      env: {},
      exists: (path) => path === system32Bash,
      where: () => [system32Bash],
    });

    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.checkedPaths).toEqual([PROGRAM_FILES_GIT_BASH, PROGRAM_FILES_X86_GIT_BASH, system32Bash]);
    }
  });

  it("#given PATH lists the WindowsApps alias before a real Git Bash #when resolving #then alias is skipped and Git Bash wins", () => {
    const windowsAppsBash = "C:/Users/dev/AppData/Local/Microsoft/WindowsApps/bash.exe";
    const gitBash = "D:\\Tools\\Git\\bin\\bash.exe";
    const result = resolveGitBash({
      platform: "win32",
      env: {},
      exists: (path) => path === windowsAppsBash || path === gitBash,
      where: () => [windowsAppsBash, gitBash],
    });

    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.path).toBe(gitBash);
      expect(result.source).toBe("path");
    }
  });

  it("#given mixed-case System32 launcher #when resolving #then it is still skipped case-insensitively", () => {
    const system32Bash = "c:\\WINDOWS\\System32\\BASH.EXE";
    const gitBash = "E:\\Git\\bin\\bash.exe";
    const result = resolveGitBash({
      platform: "win32",
      env: {},
      exists: (path) => path === system32Bash || path === gitBash,
      where: () => [system32Bash, gitBash],
    });

    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.path).toBe(gitBash);
      expect(result.source).toBe("path");
    }
  });
});

describe("resolveGitBash checkedPaths on success", () => {
  it("#given env override wins #when resolving #then checkedPaths still records the probe", () => {
    const overridePath = "D:\\Tools\\Git\\bin\\bash.exe";
    const result = resolveGitBash({
      platform: "win32",
      env: { OMO_CODEX_GIT_BASH_PATH: overridePath },
      exists: (path) => path === overridePath,
      where: () => [],
    });

    expect(result.found).toBe(true);
    if (result.found) expect(result.checkedPaths).toEqual([overridePath]);
  });

  it("#given Program Files Git Bash exists #when resolving #then checkedPaths lists the winning probe", () => {
    const result = resolveGitBash({
      platform: "win32",
      env: {},
      exists: (path) => path === PROGRAM_FILES_GIT_BASH,
      where: () => [],
    });

    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.source).toBe("program-files");
      expect(result.checkedPaths).toEqual([PROGRAM_FILES_GIT_BASH]);
    }
  });

  it("#given PATH resolution wins after skipped launchers #when resolving #then checkedPaths lists everything probed before it", () => {
    const system32Bash = "C:\\Windows\\System32\\bash.exe";
    const gitBash = "E:\\Git\\bin\\bash.exe";
    const result = resolveGitBash({
      platform: "win32",
      env: {},
      exists: (path) => path === system32Bash || path === gitBash,
      where: () => [system32Bash, gitBash],
    });

    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.checkedPaths).toEqual([PROGRAM_FILES_GIT_BASH, PROGRAM_FILES_X86_GIT_BASH, system32Bash, gitBash]);
    }
  });

  it("#given non-Windows platform #when resolving #then checkedPaths is empty", () => {
    const result = resolveGitBash({ platform: "darwin", env: {}, exists: () => false, where: () => [] });

    expect(result.found).toBe(true);
    if (result.found) expect(result.checkedPaths).toEqual([]);
  });
});
