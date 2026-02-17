import { describe, it, expect } from "bun:test";
import { detectCycles } from "./cycle-detector";

describe("cycle-detector", () => {
  describe("detectCycles", () => {
    describe("simple cycles", () => {
      //#given a circular dependency A→B→C→A
      //#when detecting cycles
      //#then returns one cycle containing A, B, C
      it("detects a simple 3-node cycle", () => {
        const graph: Record<string, string[]> = {
          A: ["B"],
          B: ["C"],
          C: ["A"],
        };

        const cycles = detectCycles(graph);

        expect(cycles).toHaveLength(1);
        expect(cycles[0]).toHaveLength(3);
        expect(cycles[0]).toContain("A");
        expect(cycles[0]).toContain("B");
        expect(cycles[0]).toContain("C");
      });

      //#given a self-referencing task A→A
      //#when detecting cycles
      //#then returns cycle ["A"]
      it("detects self-referencing cycle", () => {
        const graph: Record<string, string[]> = {
          A: ["A"],
        };

        const cycles = detectCycles(graph);

        expect(cycles).toHaveLength(1);
        expect(cycles[0]).toEqual(["A"]);
      });

      //#given a 2-node cycle A→B→A
      //#when detecting cycles
      //#then returns one cycle with A and B
      it("detects 2-node cycle", () => {
        const graph: Record<string, string[]> = {
          A: ["B"],
          B: ["A"],
        };

        const cycles = detectCycles(graph);

        expect(cycles).toHaveLength(1);
        expect(cycles[0]).toHaveLength(2);
        expect(cycles[0]).toContain("A");
        expect(cycles[0]).toContain("B");
      });
    });

    describe("acyclic graphs", () => {
      //#given a simple DAG
      //#when detecting cycles
      //#then returns empty array
      it("returns empty for acyclic graph", () => {
        const graph: Record<string, string[]> = {
          A: ["B"],
          B: ["C"],
          C: [],
        };

        const cycles = detectCycles(graph);

        expect(cycles).toEqual([]);
      });

      //#given a large acyclic DAG
      //#when detecting cycles
      //#then returns empty array
      it("returns empty for large acyclic DAG", () => {
        const graph: Record<string, string[]> = {
          A: ["B", "C"],
          B: ["D", "E"],
          C: ["E", "F"],
          D: ["G"],
          E: ["G"],
          F: ["G"],
          G: [],
        };

        const cycles = detectCycles(graph);

        expect(cycles).toEqual([]);
      });

      //#given an empty graph
      //#when detecting cycles
      //#then returns empty array
      it("returns empty for empty graph", () => {
        const cycles = detectCycles({});
        expect(cycles).toEqual([]);
      });

      //#given graph with isolated nodes
      //#when detecting cycles
      //#then returns empty array
      it("returns empty for isolated nodes", () => {
        const graph: Record<string, string[]> = {
          A: [],
          B: [],
          C: [],
        };

        const cycles = detectCycles(graph);

        expect(cycles).toEqual([]);
      });
    });

    describe("multiple cycles", () => {
      //#given two independent cycles
      //#when detecting cycles
      //#then returns both cycles
      it("detects multiple independent cycles", () => {
        const graph: Record<string, string[]> = {
          A: ["B"],
          B: ["A"],
          C: ["D"],
          D: ["C"],
        };

        const cycles = detectCycles(graph);

        expect(cycles).toHaveLength(2);
      });

      //#given cycle + acyclic part
      //#when detecting cycles
      //#then only detects the cycle
      it("detects cycle in mixed graph", () => {
        const graph: Record<string, string[]> = {
          A: ["B"],
          B: ["C"],
          C: ["A"],
          D: ["E"],
          E: [],
        };

        const cycles = detectCycles(graph);

        expect(cycles).toHaveLength(1);
        expect(cycles[0]).toContain("A");
        expect(cycles[0]).toContain("B");
        expect(cycles[0]).toContain("C");
      });
    });

    describe("edge cases", () => {
      //#given graph with node referencing non-existent node
      //#when detecting cycles
      //#then handles gracefully (no crash)
      it("handles references to non-existent nodes", () => {
        const graph: Record<string, string[]> = {
          A: ["B"],
          B: ["NONEXISTENT"],
        };

        const cycles = detectCycles(graph);

        expect(cycles).toEqual([]);
      });

      //#given single node with no edges
      //#when detecting cycles
      //#then returns empty
      it("handles single node no edges", () => {
        const graph: Record<string, string[]> = {
          A: [],
        };

        const cycles = detectCycles(graph);

        expect(cycles).toEqual([]);
      });
    });

    describe("return shape", () => {
      //#given a graph with a cycle
      //#when detecting cycles
      //#then each cycle is string array
      it("returns array of string arrays", () => {
        const graph: Record<string, string[]> = {
          A: ["B"],
          B: ["A"],
        };

        const cycles = detectCycles(graph);

        expect(Array.isArray(cycles)).toBe(true);
        for (const cycle of cycles) {
          expect(Array.isArray(cycle)).toBe(true);
          for (const node of cycle) {
            expect(typeof node).toBe("string");
          }
        }
      });
    });
  });
});
