import { describe, expect, it, mock, beforeEach } from "bun:test";
import { ProjectDetector } from "./project-detector";
import { existsSync, readFileSync } from "node:fs";

mock.module("node:fs", () => ({
  existsSync: mock(() => false),
  readFileSync: mock(() => "{}"),
}));

describe("ProjectDetector", () => {
  beforeEach(() => {
    mock.restore();
    (ProjectDetector as any)._cache.clear();
  });

  it("should detect bun from bun.lockb", async () => {
    //#given
    const { existsSync } = await import("node:fs");
    (existsSync as any).mockImplementation((path: string) => path.endsWith("bun.lockb"));

    //#when
    const detector = new ProjectDetector("/mock/project");
    const result = await detector.detect();

    //#then
    expect(result.packageManager).toBe("bun");
  });

  it("should detect npm from package-lock.json", async () => {
    //#given
    const { existsSync } = await import("node:fs");
    (existsSync as any).mockImplementation((path: string) => path.endsWith("package-lock.json"));

    //#when
    const detector = new ProjectDetector("/mock/project");
    const result = await detector.detect();

    //#then
    expect(result.packageManager).toBe("npm");
  });

  it("should detect React from package.json dependencies", async () => {
    //#given
    const { existsSync, readFileSync } = await import("node:fs");
    (existsSync as any).mockImplementation((path: string) => path.endsWith("package.json"));
    (readFileSync as any).mockImplementation(() => JSON.stringify({
      dependencies: {
        "react": "^18.0.0"
      }
    }));

    //#when
    const detector = new ProjectDetector("/mock/project");
    const result = await detector.detect();

    //#then
    expect(result.frameworks).toContain("react");
  });

  it("should cache detection results", async () => {
    //#given
    const { existsSync } = await import("node:fs");
    let callCount = 0;
    (existsSync as any).mockImplementation(() => {
      callCount++;
      return false;
    });

    //#when
    const detector = new ProjectDetector("/mock/project");
    await detector.detect();
    const countAfterFirst = callCount;
    await detector.detect();

    //#then
    expect(callCount).toBe(countAfterFirst);
    expect(countAfterFirst).toBeGreaterThan(0);
  });
});
