import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as fs from "node:fs";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RULES_INJECTOR_STORAGE } from "./constants";

type StatSnapshot = { mtimeMs: number; size: number };

let trackedRulePath = "";
let statSnapshots: Array<StatSnapshot | Error> = [];
let trackedReadFileCount = 0;
let mockedHomeDir = "";

const originalReadFileSync = fs.readFileSync.bind(fs);
const originalStatSync = fs.statSync.bind(fs);
const originalHomedir = os.homedir.bind(os);

mock.module("node:fs", () => ({
  ...fs,
  readFileSync: (filePath: string, encoding?: string) => {
    if (filePath === trackedRulePath) {
      trackedReadFileCount += 1;
    }
    return originalReadFileSync(filePath, encoding as never);
  },
  statSync: (filePath: string) => {
    if (filePath === trackedRulePath) {
      const next = statSnapshots.shift();
      if (next instanceof Error) {
        throw next;
      }
      if (next) {
        return {
          mtimeMs: next.mtimeMs,
          size: next.size,
          isFile: () => true,
        } as ReturnType<typeof originalStatSync>;
      }
    }
    return originalStatSync(filePath);
  },
}));

mock.module("node:os", () => ({
  ...os,
  homedir: () => mockedHomeDir || originalHomedir(),
}));

mock.module("./matcher", () => ({
  shouldApplyRule: () => ({ applies: true, reason: "matched" }),
  isDuplicateByRealPath: (realPath: string, cache: Set<string>) =>
    cache.has(realPath),
  createContentHash: (content: string) => `hash:${content}`,
  isDuplicateByContentHash: (hash: string, cache: Set<string>) => cache.has(hash),
}));

function createOutput(): { title: string; output: string; metadata: unknown } {
  return { title: "tool", output: "", metadata: {} };
}

async function createProcessor(projectRoot: string): Promise<{
  processFilePathForInjection: (
    filePath: string,
    sessionID: string,
    output: { title: string; output: string; metadata: unknown }
  ) => Promise<void>;
}> {
  const { createRuleInjectionProcessor } = await import("./injector");
  const sessionCaches = new Map<
    string,
    { contentHashes: Set<string>; realPaths: Set<string> }
  >();

  return createRuleInjectionProcessor({
    workspaceDirectory: projectRoot,
    truncator: {
      truncate: async (_sessionID: string, content: string) => ({
        result: content,
        truncated: false,
      }),
    },
    getSessionCache: (sessionID: string) => {
      if (!sessionCaches.has(sessionID)) {
        sessionCaches.set(sessionID, {
          contentHashes: new Set<string>(),
          realPaths: new Set<string>(),
        });
      }
      const cache = sessionCaches.get(sessionID);
      if (!cache) {
        throw new Error("Session cache should exist");
      }
      return cache;
    },
  });
}

function getInjectedRulesPath(sessionID: string): string {
  return join(RULES_INJECTOR_STORAGE, `${sessionID}.json`);
}

describe("createRuleInjectionProcessor", () => {
  let testRoot: string;
  let projectRoot: string;
  let homeRoot: string;
  let targetFile: string;
  let ruleFile: string;
  let ruleRealPath: string;

  beforeEach(() => {
    testRoot = join(tmpdir(), `rules-injector-injector-${Date.now()}`);
    projectRoot = join(testRoot, "project");
    homeRoot = join(testRoot, "home");
    targetFile = join(projectRoot, "src", "index.ts");
    ruleFile = join(
      projectRoot,
      ".github",
      "instructions",
      "typescript.instructions.md"
    );

    mkdirSync(join(projectRoot, ".git"), { recursive: true });
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    mkdirSync(join(projectRoot, ".github", "instructions"), { recursive: true });
    mkdirSync(homeRoot, { recursive: true });

    writeFileSync(targetFile, "export const value = 1;\n");
    writeFileSync(ruleFile, "rule-content\n");

    ruleRealPath = fs.realpathSync(ruleFile);
    trackedRulePath = ruleFile;
    statSnapshots = [];
    trackedReadFileCount = 0;
    mockedHomeDir = homeRoot;
  });

  afterEach(() => {
    if (fs.existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("reads and parses same file once when stat is unchanged", async () => {
    // given
    statSnapshots = [
      { mtimeMs: 1000, size: 13 },
      { mtimeMs: 1000, size: 13 },
    ];
    const processor = await createProcessor(projectRoot);

    // when
    await processor.processFilePathForInjection(targetFile, "session-1", createOutput());
    await processor.processFilePathForInjection(targetFile, "session-2", createOutput());

    // then
    expect(trackedReadFileCount).toBe(1);
  });

  it("re-reads file when mtime changes", async () => {
    // given
    statSnapshots = [
      { mtimeMs: 1000, size: 13 },
      { mtimeMs: 2000, size: 13 },
    ];
    const processor = await createProcessor(projectRoot);

    // when
    await processor.processFilePathForInjection(targetFile, "session-1", createOutput());
    await processor.processFilePathForInjection(targetFile, "session-2", createOutput());

    // then
    expect(trackedReadFileCount).toBe(2);
  });

  it("re-reads file when size changes", async () => {
    // given
    statSnapshots = [
      { mtimeMs: 1000, size: 13 },
      { mtimeMs: 1000, size: 21 },
    ];
    const processor = await createProcessor(projectRoot);

    // when
    await processor.processFilePathForInjection(targetFile, "session-1", createOutput());
    await processor.processFilePathForInjection(targetFile, "session-2", createOutput());

    // then
    expect(trackedReadFileCount).toBe(2);
  });

  it("does not save injected rules when all candidates are already cached", async () => {
    // given
    const sessionID = `dirty-no-new-${Date.now()}`;
    const injectedPath = getInjectedRulesPath(sessionID);
    if (fs.existsSync(injectedPath)) {
      fs.unlinkSync(injectedPath);
    }

    const { createRuleInjectionProcessor } = await import("./injector");
    const processor = createRuleInjectionProcessor({
      workspaceDirectory: projectRoot,
      truncator: {
        truncate: async (_sessionID: string, content: string) => ({
          result: content,
          truncated: false,
        }),
      },
      getSessionCache: () => ({
        contentHashes: new Set<string>(),
        realPaths: new Set<string>([ruleRealPath]),
      }),
    });

    // when
    await processor.processFilePathForInjection(targetFile, sessionID, createOutput());

    // then
    expect(fs.existsSync(injectedPath)).toBe(false);
  });

  it("saves injected rules when a new rule is added", async () => {
    // given
    const sessionID = `dirty-new-${Date.now()}`;
    const injectedPath = getInjectedRulesPath(sessionID);
    if (fs.existsSync(injectedPath)) {
      fs.unlinkSync(injectedPath);
    }
    const processor = await createProcessor(projectRoot);

    // when
    await processor.processFilePathForInjection(targetFile, sessionID, createOutput());

    // then
    expect(fs.existsSync(injectedPath)).toBe(true);

    if (fs.existsSync(injectedPath)) {
      fs.unlinkSync(injectedPath);
    }
  });

  it("falls back to direct read and parse when statSync throws", async () => {
    // given
    statSnapshots = [new Error("stat failed"), new Error("stat failed")];
    const processor = await createProcessor(projectRoot);

    // when
    await processor.processFilePathForInjection(targetFile, "session-1", createOutput());
    await processor.processFilePathForInjection(targetFile, "session-2", createOutput());

    // then
    expect(trackedReadFileCount).toBe(2);
  });
});
