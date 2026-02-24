import { describe, expect, it } from "bun:test"

import {
  formatDiagnosticsOutput,
  formatSymbolsOutput,
  formatDiagnostic,
  formatSymbolInfo,
  formatDocumentSymbol,
} from "./lsp-formatters"
import type { Diagnostic, DocumentSymbol, SymbolInfo } from "./types"


describe("lsp-formatters", () => {
  describe("#given diagnostics formatter", () => {
    const createDiagnostic = (line: number, message: string, severity = 1): Diagnostic => ({
      range: {
        start: { line, character: 0 },
        end: { line, character: 10 },
      },
      message,
      severity,
      source: "test",
      code: "E001",
    })

    describe("#when formatting single diagnostic", () => {
      it("returns formatted string without compression", () => {
        const diagnostics = [createDiagnostic(0, "Test error")]

        const result = formatDiagnosticsOutput(diagnostics, { enabled: true, threshold: 100 })

        expect(result).toContain("error")
        expect(result).toContain("Test error")
        expect(result).not.toContain("[Compressed")
      })
    })

    describe("#when formatting empty diagnostics", () => {
      it("returns no diagnostics message", () => {
        const result = formatDiagnosticsOutput([], { enabled: true, threshold: 100 })

        expect(result).toBe("No diagnostics found")
      })
    })

    describe("#when compression is disabled", () => {
      it("returns plain text output even with many diagnostics", () => {
        const diagnostics = Array.from({ length: 10 }, (_, i) =>
          createDiagnostic(i, `Error message ${i} with some longer text to increase size`)
        )

        const result = formatDiagnosticsOutput(diagnostics, { enabled: false, threshold: 10 })

        expect(result).toContain("Error message 0")
        expect(result).not.toContain("[Compressed")
      })
    })

    describe("#when compression enabled and threshold met", () => {
      it("returns compressed output for large uniform arrays", () => {
        const diagnostics = Array.from({ length: 10 }, (_, i) =>
          createDiagnostic(i, `Error message ${i} with enough text to pass threshold`)
        )

        const result = formatDiagnosticsOutput(diagnostics, { enabled: true, threshold: 100 })

        expect(result).toContain("[Compressed diagnostics]")
      })
    })

    describe("#when below minimum item count", () => {
      it("does not compress even if threshold met", () => {
        const diagnostics = Array.from({ length: 4 }, (_, i) =>
          createDiagnostic(i, `Error message ${i} with enough text`)
        )

        const result = formatDiagnosticsOutput(diagnostics, { enabled: true, threshold: 10 })

        expect(result).not.toContain("[Compressed")
        expect(result).toContain("Error message 0")
      })
    })
  })

  describe("#given symbols formatter with SymbolInfo", () => {
    const createSymbolInfo = (name: string, line: number): SymbolInfo => ({
      name,
      kind: 12,
      location: {
        uri: "file:///test.ts",
        range: {
          start: { line, character: 0 },
          end: { line, character: 10 },
        },
      },
      containerName: "TestClass",
    })

    describe("#when formatting single symbol", () => {
      it("returns formatted string without compression", () => {
        const symbols = [createSymbolInfo("testFunc", 5)]

        const result = formatSymbolsOutput(symbols, { enabled: true, threshold: 100 })

        expect(result).toContain("testFunc")
        expect(result).toContain("Function")
        expect(result).not.toContain("[Compressed")
      })
    })

    describe("#when formatting empty symbols", () => {
      it("returns no symbols message", () => {
        const result = formatSymbolsOutput([], { enabled: true, threshold: 100 })

        expect(result).toBe("No symbols found")
      })
    })

    describe("#when compression enabled and threshold met", () => {
      it("returns compressed output for large uniform arrays", () => {
        const symbols = Array.from({ length: 10 }, (_, i) =>
          createSymbolInfo(`function${i}`, i * 5)
        )

        const result = formatSymbolsOutput(symbols, { enabled: true, threshold: 100 })

        expect(result).toContain("[Compressed symbols]")
      })
    })

    describe("#when below minimum item count", () => {
      it("does not compress even if threshold met", () => {
        const symbols = Array.from({ length: 4 }, (_, i) => createSymbolInfo(`fn${i}`, i))

        const result = formatSymbolsOutput(symbols, { enabled: true, threshold: 10 })

        expect(result).not.toContain("[Compressed")
        expect(result).toContain("fn0")
      })
    })
  })

  describe("#given symbols formatter with DocumentSymbol", () => {
    const createDocumentSymbol = (name: string, line: number): DocumentSymbol => ({
      name,
      kind: 12,
      range: {
        start: { line, character: 0 },
        end: { line, character: 10 },
      },
      selectionRange: {
        start: { line, character: 0 },
        end: { line, character: 10 },
      },
      children: [],
    })

    describe("#when formatting single document symbol", () => {
      it("returns formatted string without compression", () => {
        const symbols = [createDocumentSymbol("testFunc", 5)]

        const result = formatSymbolsOutput(symbols, { enabled: true, threshold: 100 })

        expect(result).toContain("testFunc")
        expect(result).not.toContain("[Compressed")
      })
    })

    describe("#when compression enabled and threshold met", () => {
      it("returns compressed output for large uniform arrays", () => {
        const symbols = Array.from({ length: 10 }, (_, i) =>
          createDocumentSymbol(`function${i}`, i * 5)
        )

        const result = formatSymbolsOutput(symbols, { enabled: true, threshold: 100 })

        expect(result).toContain("[Compressed symbols]")
      })
    })
  })

  describe("#given individual formatters", () => {
    describe("#when formatting diagnostic", () => {
      it("includes severity, location, and message", () => {
        const diag: Diagnostic = {
          range: {
            start: { line: 10, character: 5 },
            end: { line: 10, character: 15 },
          },
          message: "Test error message",
          severity: 1,
          source: "eslint",
          code: "no-unused-vars",
        }

        const result = formatDiagnostic(diag)

        expect(result).toContain("error")
        expect(result).toContain("[eslint]")
        expect(result).toContain("(no-unused-vars)")
        expect(result).toContain("11:5")
        expect(result).toContain("Test error message")
      })
    })

    describe("#when formatting symbol info", () => {
      it("includes name, kind, container, and location", () => {
        const symbol: SymbolInfo = {
          name: "myFunction",
          kind: 12,
          location: {
            uri: "file:///src/index.ts",
            range: {
              start: { line: 25, character: 0 },
              end: { line: 30, character: 1 },
            },
          },
          containerName: "MyClass",
        }

        const result = formatSymbolInfo(symbol)

        expect(result).toContain("myFunction")
        expect(result).toContain("Function")
        expect(result).toContain("(in MyClass)")
        expect(result).toContain("26:0")
      })
    })

    describe("#when formatting document symbol with children", () => {
      it("includes nested children with indentation", () => {
        const symbol: DocumentSymbol = {
          name: "MyClass",
          kind: 5,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 50, character: 1 },
          },
          selectionRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 10 },
          },
          children: [
            {
              name: "myMethod",
              kind: 6,
              range: {
                start: { line: 10, character: 2 },
                end: { line: 20, character: 3 },
              },
              selectionRange: {
                start: { line: 10, character: 2 },
                end: { line: 10, character: 12 },
              },
              children: [],
            },
          ],
        }

        const result = formatDocumentSymbol(symbol)

        expect(result).toContain("MyClass")
        expect(result).toContain("Class")
        expect(result).toContain("myMethod")
        expect(result).toContain("Method")
      })
    })
  })
})
