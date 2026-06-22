import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetRuleCacheForTesting } from "./injector";

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

describe("rulesInjector cache", () => {
  let testRoot: string;
  let projectRoot: string;
  let targetFile: string;
  let ruleFile: string;
  let readFileCalls: string[];
  let readFileSpy: ReturnType<typeof spyOn>;
  let originalReadFileSync: typeof fs.readFileSync;

  beforeEach(() => {
    testRoot = join(
      tmpdir(),
      `rules-injector-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    projectRoot = join(testRoot, "project");
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

    writeFileSync(targetFile, "export const value = 1;\n");
    writeFileSync(ruleFile, "rule-content\n");

    readFileCalls = [];
    originalReadFileSync = fs.readFileSync.bind(fs);
    readFileSpy = spyOn(fs, "readFileSync").mockImplementation(((
      filePath: fs.PathOrFileDescriptor,
      ...rest: unknown[]
    ) => {
      const pathStr =
        typeof filePath === "string"
          ? filePath
          : (filePath as { toString(): string }).toString();
      readFileCalls.push(pathStr);
      return (originalReadFileSync as (...a: unknown[]) => unknown)(
        filePath,
        ...rest
      );
    }) as typeof fs.readFileSync);
  });

  afterEach(() => {
    readFileSpy.mockRestore();
    _resetRuleCacheForTesting();
    if (fs.existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("rulesInjector cache hit on 2nd call with same cwd", async () => {
    //#given
    const processor = await createProcessor(projectRoot);

    //#when
    await processor.processFilePathForInjection(
      targetFile,
      "session-1",
      createOutput()
    );
    const callsAfter1st = readFileCalls.filter(
      (p) => p === ruleFile || p === fs.realpathSync(ruleFile)
    ).length;

    await processor.processFilePathForInjection(
      targetFile,
      "session-2",
      createOutput()
    );
    const callsAfter2nd = readFileCalls.filter(
      (p) => p === ruleFile || p === fs.realpathSync(ruleFile)
    ).length;

    //#then: 1st call reads the file once, 2nd call is a cache hit (0 additional reads)
    expect(callsAfter1st).toBe(1);
    expect(callsAfter2nd).toBe(1);
  });

  it("rulesInjector cache invalidated on rule file edit", async () => {
    //#given
    const processor = await createProcessor(projectRoot);

    await processor.processFilePathForInjection(
      targetFile,
      "session-1",
      createOutput()
    );
    const callsAfter1st = readFileCalls.filter(
      (p) => p === ruleFile || p === fs.realpathSync(ruleFile)
    ).length;

    //#when: bump mtime on the rule file and wait past the watcher debounce
    const futureTime = new Date(Date.now() + 5000);
    utimesSync(ruleFile, futureTime, futureTime);
    await new Promise((resolve) => setTimeout(resolve, 1200));

    await processor.processFilePathForInjection(
      targetFile,
      "session-2",
      createOutput()
    );
    const callsAfter2nd = readFileCalls.filter(
      (p) => p === ruleFile || p === fs.realpathSync(ruleFile)
    ).length;

    //#then: watcher invalidated the cache entry, so the 2nd call re-reads
    expect(callsAfter1st).toBe(1);
    expect(callsAfter2nd).toBe(2);
  });
});
