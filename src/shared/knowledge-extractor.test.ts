import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { KnowledgeExtractor } from "./knowledge-extractor";
import { unlinkSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe("KnowledgeExtractor", () => {
  const testKnowledgePath = join(import.meta.dir, "knowledge.json");

  beforeEach(() => {
    if (existsSync(testKnowledgePath)) {
      unlinkSync(testKnowledgePath);
    }
  });

  afterEach(() => {
    if (existsSync(testKnowledgePath)) {
      unlinkSync(testKnowledgePath);
    }
  });

  it("should extract resolved bug patterns", async () => {
    //#given
    const extractor = new KnowledgeExtractor(testKnowledgePath);
    const resolvedIssue = {
      description: "Fix memory leak in background worker",
      fix: "Ensure clearInterval is called on cleanup",
      context: "worker.ts"
    };

    //#when
    const entry = await extractor.extract(resolvedIssue);

    //#then
    expect(entry.pattern).toContain("memory leak");
    expect(entry.solution).toContain("clearInterval");
  });

  it("should persist to knowledge.json", async () => {
    //#given
    const extractor = new KnowledgeExtractor(testKnowledgePath);
    const resolvedIssue = {
      description: "Race condition in state update",
      fix: "Use functional update for setState",
      context: "component.ts"
    };

    //#when
    await extractor.extractAndSave(resolvedIssue);

    //#then
    expect(existsSync(testKnowledgePath)).toBe(true);
    const content = JSON.parse(await Bun.file(testKnowledgePath).text());
    expect(content.length).toBe(1);
    expect(content[0].pattern).toContain("race condition");
  });

  it("should preserve key knowledge during compression", async () => {
    //#given
    const extractor = new KnowledgeExtractor(testKnowledgePath);
    for (let i = 0; i < 10; i++) {
      await extractor.extractAndSave({
        description: `Bug ${i}`,
        fix: `Fix ${i}`,
        context: "test.ts"
      });
    }

    //#when
    // Compress to limit of 5 entries
    await extractor.compress(5);

    //#then
    const content = JSON.parse(await Bun.file(testKnowledgePath).text());
    expect(content.length).toBe(5);
    // Should keep the latest ones (Bug 5 to Bug 9)
    expect(content[0].pattern).toContain("bug 5");
    expect(content[4].pattern).toContain("bug 9");
  });

  it("should clean up expired knowledge", async () => {
    //#given
    const extractor = new KnowledgeExtractor(testKnowledgePath);
    // Old entry (31 days ago)
    const oldEntry = {
      id: "old",
      pattern: "old bug",
      solution: "old fix",
      timestamp: Date.now() - 31 * 24 * 60 * 60 * 1000
    };
    // New entry (1 hour ago)
    const newEntry = {
      id: "new",
      pattern: "new bug",
      solution: "new fix",
      timestamp: Date.now() - 60 * 60 * 1000
    };
    
    // Manually save them
    const writeFileSync = (await import("node:fs")).writeFileSync;
    writeFileSync(testKnowledgePath, JSON.stringify([oldEntry, newEntry]));

    //#when
    // Cleanup items older than 30 days
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    await extractor.cleanup(thirtyDaysMs);

    //#then
    const content = JSON.parse(await Bun.file(testKnowledgePath).text());
    expect(content.length).toBe(1);
    expect(content[0].id).toBe("new");
  });
});
