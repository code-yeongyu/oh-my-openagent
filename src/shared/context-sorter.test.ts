import { describe, it, expect } from "bun:test";
import { ContextSorter, type ContextMode, type ContextFile } from "./context-sorter";

describe("ContextSorter", () => {
  //#given
  const files: ContextFile[] = [
    { path: "src/index.ts", weight: 1 },
    { path: "src/index.test.ts", weight: 1 },
    { path: "docs/README.md", weight: 1 },
    { path: "examples/basic.ts", weight: 1 },
    { path: "src/shared/utils.ts", weight: 1 },
  ];

  it("should boost test files weight in review mode", () => {
    //#given
    const sorter = new ContextSorter("review");

    //#when
    const sorted = sorter.sort(files);

    //#then
    const testFile = sorted.find(f => f.path.includes(".test.ts"));
    const codeFile = sorted.find(f => f.path === "src/index.ts");
    expect(testFile!.weight).toBeGreaterThan(codeFile!.weight);
  });

  it("should boost documentation weight in research mode", () => {
    //#given
    const sorter = new ContextSorter("research");

    //#when
    const sorted = sorter.sort(files);

    //#then
    const docFile = sorted.find(f => f.path.endsWith(".md"));
    const exampleFile = sorted.find(f => f.path.includes("examples/"));
    const codeFile = sorted.find(f => f.path === "src/index.ts");
    
    expect(docFile!.weight).toBeGreaterThan(codeFile!.weight);
    expect(exampleFile!.weight).toBeGreaterThan(codeFile!.weight);
  });

  it("should use default weights in development mode", () => {
    //#given
    const sorter = new ContextSorter("development");

    //#when
    const sorted = sorter.sort(files);

    //#then
    // In development mode, they should roughly stay the same or follow default logic
    // Here we check if weights remain as input if no specific logic applied
    expect(sorted[0].weight).toBe(1);
  });

  it("should allow custom weight configuration", () => {
    //#given
    const customWeights = {
      test: 10,
      docs: 5
    };
    const sorter = new ContextSorter("development", customWeights);

    //#when
    const sorted = sorter.sort(files);

    //#then
    const testFile = sorted.find(f => f.path.includes(".test.ts"));
    const docFile = sorted.find(f => f.path.endsWith(".md"));
    
    expect(testFile!.weight).toBe(10);
    expect(docFile!.weight).toBe(5);
  });
});
