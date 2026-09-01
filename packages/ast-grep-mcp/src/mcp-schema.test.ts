import { describe, expect, it } from "bun:test";
import { AST_GREP_MCP_TOOLS } from "./mcp";
import { SCAN_TOOL_DESCRIPTION, scanInputSchema } from "./tools/scan";

// The advertised inputSchema is the ONLY contract a client sees before it calls a tool.
// Anything the parser rejects at execution time but the schema accepts is a lie the model
// pays for with a wasted round trip, so these tests pin the descriptor against the parsers.
//
// Size-limit representation (defect 3): the parsers measure `pattern`, `rewrite` and
// `inlineRules` with Buffer.byteLength (UTF-8 BYTES) while JSON Schema `maxLength` counts
// Unicode CODE POINTS. A code-point maxLength cannot express a byte budget faithfully — a
// 10k-code-point CJK pattern is 30k bytes — so the byte limit is published as a description
// annotation instead of a maxLength keyword, and the parser stays authoritative.
// Verified against the shipped parsers, not the report's "262144 chars": search
// MAX_PATTERN_BYTES=16*1024, rewrite MAX_PATTERN_BYTES=16*1024 / MAX_REWRITE_BYTES=64*1024,
// scan MAX_INLINE_RULE_BYTES=64*1024 (plan todo 7: "same bounds as search").

type Schema = Record<string, unknown>;

function schemaOf(name: string): Schema {
  const tool = AST_GREP_MCP_TOOLS.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`no descriptor for ${name}`);
  return tool.inputSchema as Schema;
}

function propertyOf(name: string, property: string): Schema {
  const properties = schemaOf(name).properties as Record<string, Schema> | undefined;
  const value = properties?.[property];
  if (value === undefined) throw new Error(`no property ${property} on ${name}`);
  return value;
}

describe("ast_grep descriptors: client-safe composition", () => {
  it("#given every advertised inputSchema #when walked to any depth #then no oneOf/anyOf/allOf/not appears", () => {
    // Cursor's AgentService gateway cannot carry JSON-Schema composition keywords in an
    // advertised tool inputSchema: the protobuf conversion fails upstream and the WHOLE run
    // dies with a wrapped `resource_exhausted`. The parsers enforce every contract the schema
    // cannot express (scan rule-source exclusivity included), so these keys must never ship.
    const COMPOSITION_KEYS = new Set(["oneOf", "anyOf", "allOf", "not"]);
    const offenders: string[] = [];
    const walk = (node: unknown, trail: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${trail}[${index}]`));
        return;
      }
      if (typeof node !== "object" || node === null) return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (COMPOSITION_KEYS.has(key)) offenders.push(`${trail}.${key}`);
        walk(value, `${trail}.${key}`);
      }
    };
    for (const tool of AST_GREP_MCP_TOOLS) walk(tool.inputSchema, tool.name);
    expect(offenders).toEqual([]);
  });
});

describe("ast_grep scan descriptor: rule-source exclusivity", () => {
  // The XOR contract cannot ride in the schema (see the composition test above), so it is
  // published in prose the model reads and enforced by the parser that runs the call.
  it("#given the scan schema #when inspected #then exclusivity is published without composition keywords", () => {
    const schema = schemaOf("scan");
    expect(schema.oneOf).toBeUndefined();
    expect(schema.required).toEqual(["paths"]);
    expect(String(propertyOf("scan", "ruleFile").description)).toContain("Mutually exclusive with inlineRules");
    expect(String(propertyOf("scan", "inlineRules").description)).toContain("Mutually exclusive with ruleFile");
    expect(String(SCAN_TOOL_DESCRIPTION)).toContain("Provide either ruleFile or inlineRules");
  });

  it("#given scan args with NO rule source #when parsed #then the parser rejects them", () => {
    expect(() => scanInputSchema.parse({ paths: ["src"] })).toThrow(
      "Exactly one of ruleFile or inlineRules must be provided",
    );
  });

  it("#given scan args with BOTH rule sources #when parsed #then the parser rejects them", () => {
    expect(() => scanInputSchema.parse({ paths: ["src"], ruleFile: "r.yml", inlineRules: "id: x" })).toThrow(
      "Exactly one of ruleFile or inlineRules must be provided",
    );
  });

  it("#given scan args with exactly one rule source #when parsed #then the parser accepts them", () => {
    expect(() => scanInputSchema.parse({ paths: ["src"], ruleFile: "r.yml" })).not.toThrow();
    expect(() => scanInputSchema.parse({ paths: ["src"], inlineRules: "id: x" })).not.toThrow();
  });
});

describe("ast_grep descriptors: advertised size limits", () => {
  it("#given the search pattern property #when inspected #then the 16 KiB BYTE budget is published", () => {
    const pattern = propertyOf("search", "pattern");
    expect(String(pattern.description)).toContain("16 KiB");
    expect(String(pattern.description)).toContain("BYTES");
    // A code-point maxLength would misdescribe a byte budget; it is intentionally absent.
    expect(pattern.maxLength).toBeUndefined();
  });

  it("#given the rewrite tool #when inspected #then pattern 16 KiB and rewrite 64 KiB BYTE budgets are published", () => {
    expect(String(propertyOf("rewrite", "pattern").description)).toContain("16 KiB");
    expect(String(propertyOf("rewrite", "pattern").description)).toContain("BYTES");
    const rewrite = propertyOf("rewrite", "rewrite");
    expect(String(rewrite.description)).toContain("64 KiB");
    expect(String(rewrite.description)).toContain("BYTES");
    expect(rewrite.maxLength).toBeUndefined();
  });

  it("#given the scan inlineRules property #when inspected #then the 64 KiB BYTE budget is published", () => {
    const inlineRules = propertyOf("scan", "inlineRules");
    expect(String(inlineRules.description)).toContain("64 KiB");
    expect(String(inlineRules.description)).toContain("BYTES");
    expect(inlineRules.maxLength).toBeUndefined();
  });

  it("#given code-point-measured properties #when inspected #then they keep numeric maxLength (parser uses code points)", () => {
    // These parsers count code points, so maxLength is faithful and stays machine-checkable.
    expect(propertyOf("search", "selector").maxLength).toBe(128);
    expect(propertyOf("search", "workdir").maxLength).toBe(4096);
    expect(propertyOf("scan", "ruleFile").maxLength).toBe(4096);
  });
});
