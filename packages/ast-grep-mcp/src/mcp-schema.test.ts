import { describe, expect, it } from "bun:test";
import { AST_GREP_MCP_TOOLS } from "./mcp";

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

/**
 * Minimal validator covering exactly the keywords these descriptors use for the
 * rule-source contract: required, not.required and oneOf. Deliberately hand-rolled —
 * the package ships bun-types only, and pulling a JSON Schema engine in for three
 * keywords would be a heavier dependency than the assertion is worth.
 */
function satisfies(schema: Schema, value: Record<string, unknown>): boolean {
  const required = schema.required;
  if (Array.isArray(required) && !required.every((key) => typeof key === "string" && value[key] !== undefined)) {
    return false;
  }
  const negated = schema.not;
  if (negated !== undefined && satisfies(negated as Schema, value)) return false;
  const oneOf = schema.oneOf;
  if (Array.isArray(oneOf)) {
    const matched = oneOf.filter((branch) => satisfies(branch as Schema, value)).length;
    if (matched !== 1) return false;
  }
  return true;
}

describe("ast_grep scan descriptor: rule-source exclusivity", () => {
  it("#given the scan schema #when inspected #then it publishes the ruleFile XOR inlineRules oneOf", () => {
    const schema = schemaOf("scan");
    expect(schema.oneOf).toEqual([
      { type: "object", required: ["ruleFile"], not: { required: ["inlineRules"] } },
      { type: "object", required: ["inlineRules"], not: { required: ["ruleFile"] } },
    ]);
    expect(schema.required).toEqual(["paths"]);
  });

  it("#given scan args with NO rule source #when validated against the descriptor #then they are schema-invalid", () => {
    expect(satisfies(schemaOf("scan"), { paths: ["src"] })).toBe(false);
  });

  it("#given scan args with BOTH rule sources #when validated against the descriptor #then they are schema-invalid", () => {
    expect(satisfies(schemaOf("scan"), { paths: ["src"], ruleFile: "r.yml", inlineRules: "id: x" })).toBe(false);
  });

  it("#given scan args with exactly one rule source #when validated against the descriptor #then they are schema-valid", () => {
    expect(satisfies(schemaOf("scan"), { paths: ["src"], ruleFile: "r.yml" })).toBe(true);
    expect(satisfies(schemaOf("scan"), { paths: ["src"], inlineRules: "id: x" })).toBe(true);
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
