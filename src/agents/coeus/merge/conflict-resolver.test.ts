import { describe, it, expect } from "bun:test";
import { buildConflictResolutionPrompt } from "./conflict-resolver";
import type { FileOverlap } from "../validation/overlap-detector";

describe("buildConflictResolutionPrompt", () => {
  //#given no conflicts (no overlaps, no cycles)
  //#when buildConflictResolutionPrompt is called with empty arrays
  //#then returns empty string
  it("returns empty string when no conflicts exist", () => {
    const result = buildConflictResolutionPrompt([], []);
    expect(result).toBe("");
  });

  //#given file overlaps only
  //#when buildConflictResolutionPrompt is called with overlaps but no cycles
  //#then returns prompt with File Overlaps section but no Dependency Cycles section
  it("includes File Overlaps section when overlaps exist", () => {
    const overlaps: FileOverlap[] = [
      { file: "src/index.ts", sub_plans: ["auth", "core"] },
    ];
    const result = buildConflictResolutionPrompt(overlaps, []);

    expect(result).toContain("## Conflicts Detected — Resolution Required");
    expect(result).toContain("### File Overlaps");
    expect(result).toContain("`src/index.ts`");
    expect(result).toContain("auth, core");
    expect(result).not.toContain("### Dependency Cycles");
  });

  //#given dependency cycles only
  //#when buildConflictResolutionPrompt is called with cycles but no overlaps
  //#then returns prompt with Dependency Cycles section but no File Overlaps section
  it("includes Dependency Cycles section when cycles exist", () => {
    const cycles = [["auth", "core", "auth"]];
    const result = buildConflictResolutionPrompt([], cycles);

    expect(result).toContain("## Conflicts Detected — Resolution Required");
    expect(result).toContain("### Dependency Cycles");
    expect(result).toContain("auth → core → auth");
    expect(result).not.toContain("### File Overlaps");
  });

  //#given both overlaps and cycles
  //#when buildConflictResolutionPrompt is called with both
  //#then returns prompt with both sections
  it("includes both sections when both overlaps and cycles exist", () => {
    const overlaps: FileOverlap[] = [
      { file: "src/config.ts", sub_plans: ["auth", "db"] },
    ];
    const cycles = [["auth", "db", "auth"]];
    const result = buildConflictResolutionPrompt(overlaps, cycles);

    expect(result).toContain("### File Overlaps");
    expect(result).toContain("### Dependency Cycles");
    expect(result).toContain("### Resolution Instructions");
  });

  //#given multiple file overlaps
  //#when buildConflictResolutionPrompt is called
  //#then all overlaps are listed with correct sub-plan names
  it("lists all overlaps with correct sub-plan names", () => {
    const overlaps: FileOverlap[] = [
      { file: "src/auth.ts", sub_plans: ["auth", "core", "security"] },
      { file: "src/db.ts", sub_plans: ["db", "cache"] },
    ];
    const result = buildConflictResolutionPrompt(overlaps, []);

    expect(result).toContain("`src/auth.ts`");
    expect(result).toContain("auth, core, security");
    expect(result).toContain("`src/db.ts`");
    expect(result).toContain("db, cache");
  });

  //#given a cycle with multiple nodes
  //#when buildConflictResolutionPrompt is called
  //#then cycle is rendered as "A → B → C → A" format
  it("renders multi-node cycle in correct format", () => {
    const cycles = [["auth", "db", "cache", "auth"]];
    const result = buildConflictResolutionPrompt([], cycles);

    expect(result).toContain("auth → db → cache → auth");
  });

  //#given a self-referencing cycle
  //#when buildConflictResolutionPrompt is called
  //#then cycle is rendered as "A → A"
  it("renders self-referencing cycle correctly", () => {
    const cycles = [["auth", "auth"]];
    const result = buildConflictResolutionPrompt([], cycles);

    expect(result).toContain("auth → auth");
  });

  //#given conflicts exist
  //#when buildConflictResolutionPrompt is called
  //#then output contains Resolution Instructions section
  it("includes Resolution Instructions section when conflicts exist", () => {
    const overlaps: FileOverlap[] = [
      { file: "src/index.ts", sub_plans: ["a", "b"] },
    ];
    const result = buildConflictResolutionPrompt(overlaps, []);

    expect(result).toContain("### Resolution Instructions");
    expect(result).toContain("1. Which sub-plan should own each overlapping file");
    expect(result).toContain("2. How to break each dependency cycle");
    expect(result).toContain("3. Any task reordering needed");
    expect(result).toContain("Respond with a JSON array of resolution actions");
  });

  //#given multiple cycles
  //#when buildConflictResolutionPrompt is called
  //#then all cycles are listed
  it("lists all cycles when multiple exist", () => {
    const cycles = [
      ["a", "b", "a"],
      ["x", "y", "z", "x"],
    ];
    const result = buildConflictResolutionPrompt([], cycles);

    expect(result).toContain("a → b → a");
    expect(result).toContain("x → y → z → x");
  });
});
