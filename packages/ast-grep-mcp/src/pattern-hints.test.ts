import { describe, expect, it } from "bun:test";
import {
  validatePatternHints,
  validateRewriteHints,
  extractMetavars,
  type ValidationOpts,
} from "./pattern-hints";

// ---------- extractMetavars ----------

describe("extractMetavars", () => {
  type ExtractCase = {
    name: string;
    text: string;
    single: string[];
    multi: string[];
  };

  const cases: ExtractCase[] = [
    { name: "single metavar $MSG", text: "console.log($MSG)", single: ["MSG"], multi: [] },
    { name: "multi metavar $$$ARGS", text: "foo($$$ARGS)", single: [], multi: ["ARGS"] },
    { name: "mixed single and multi", text: "foo($A, $$$B)", single: ["A"], multi: ["B"] },
    { name: "wildcard underscore excluded", text: "foo($_)", single: [], multi: [] },
    { name: "multi wildcard excluded", text: "foo($$$)", single: [], multi: [] },
    { name: "same name as single and multi", text: "$A + $$$A", single: ["A"], multi: ["A"] },
    { name: "no metavars", text: "console.log(42)", single: [], multi: [] },
    { name: "multiple singles", text: "$A + $B", single: ["A", "B"], multi: [] },
    { name: "multiple multis", text: "$$$X, $$$Y", single: [], multi: ["X", "Y"] },
    { name: "double dollar not captured", text: "$$ARGS", single: [], multi: [] },
    { name: "lowercase not captured", text: "$foo", single: [], multi: [] },
  ];

  for (const c of cases) {
    it(c.name, () => {
      // given: a text string with metavariable references
      // when: extracting metavars
      // then: single and multi sets match expectations
      const result = extractMetavars(c.text);
      expect([...result.single].sort()).toEqual(c.single.sort());
      expect([...result.multi].sort()).toEqual(c.multi.sort());
    });
  }
});

// ---------- validatePatternHints: hard-reject rules (force bypasses) ----------

describe("validatePatternHints - hard reject rules", () => {
  type HardRejectCase = {
    name: string;
    pattern: string;
    language: string;
    hintCode: string;
  };

  const cases: HardRejectCase[] = [
    { name: "regex \\w escape", pattern: "\\w+", language: "typescript", hintCode: "REGEX_BACKSLASH_ESCAPE" },
    { name: "regex \\d escape", pattern: "\\d+", language: "typescript", hintCode: "REGEX_BACKSLASH_ESCAPE" },
    { name: "regex \\s escape", pattern: "\\s+", language: "typescript", hintCode: "REGEX_BACKSLASH_ESCAPE" },
    { name: "regex \\b escape", pattern: "\\bword\\b", language: "typescript", hintCode: "REGEX_BACKSLASH_ESCAPE" },
    { name: "regex .* wildcard", pattern: ".*foo", language: "typescript", hintCode: "REGEX_DOT_STAR" },
    { name: "regex .+ wildcard", pattern: ".+foo", language: "typescript", hintCode: "REGEX_DOT_STAR" },
    { name: "regex char class [a-z]", pattern: "[a-z]", language: "typescript", hintCode: "REGEX_CHAR_CLASS" },
    { name: "regex char class [a-zA-Z0-9]", pattern: "[a-zA-Z0-9]", language: "typescript", hintCode: "REGEX_CHAR_CLASS" },
    { name: "python trailing colon def", pattern: "def foo($X):", language: "python", hintCode: "PATTERN_INCOMPLETE_FORM" },
    { name: "python trailing colon class", pattern: "class Foo($X):", language: "python", hintCode: "PATTERN_INCOMPLETE_FORM" },
    { name: "JS incomplete function", pattern: "function foo", language: "javascript", hintCode: "PATTERN_INCOMPLETE_FORM" },
    { name: "TS incomplete function", pattern: "function foo", language: "typescript", hintCode: "PATTERN_INCOMPLETE_FORM" },
    { name: "Go incomplete function", pattern: "func foo", language: "go", hintCode: "PATTERN_INCOMPLETE_FORM" },
    { name: "Rust incomplete function", pattern: "fn foo", language: "rust", hintCode: "PATTERN_INCOMPLETE_FORM" },
    { name: "double dollar $$ARGS", pattern: "$$ARGS", language: "typescript", hintCode: "METAVAR_DOUBLE_DOLLAR" },
    { name: "invalid metavar name lowercase", pattern: "$foo", language: "typescript", hintCode: "INVALID_METAVAR_NAME" },
  ];

  for (const c of cases) {
    it(`${c.name} - rejected without force`, () => {
      // given: a pattern with a hard-reject hint issue
      // when: validating without force
      // then: rejected with PATTERN_HINT_REJECTED and the specific hint code
      const result = validatePatternHints(c.pattern, c.language);
      expect(result.rejected).toBe(true);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("PATTERN_HINT_REJECTED");
      expect(result.hints.some((h) => h.code === c.hintCode)).toBe(true);
    });

    it(`${c.name} - force=true bypasses`, () => {
      // given: a pattern with a hard-reject hint issue
      // when: validating with force=true
      // then: not rejected (hint still present but bypassed)
      const result = validatePatternHints(c.pattern, c.language, { force: true });
      expect(result.rejected).toBe(false);
      expect(result.ok).toBe(true);
      expect(result.code).toBeNull();
      expect(result.hints.some((h) => h.code === c.hintCode)).toBe(true);
    });
  }
});

// ---------- validatePatternHints: warn rules (never reject) ----------

describe("validatePatternHints - warn rules", () => {
  it("bare alternation warns but does not reject", () => {
    // given: a pattern with bare | alternation
    // when: validating without force
    // then: not rejected, but BARE_ALTERNATION hint is present
    const result = validatePatternHints("a|b", "typescript");
    expect(result.rejected).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.hints.some((h) => h.code === "BARE_ALTERNATION" && h.severity === "warn")).toBe(true);
  });

  it("bare alternation warns even with force=true", () => {
    // given: a pattern with bare | alternation
    // when: validating with force=true
    // then: still not rejected, still warned
    const result = validatePatternHints("a|b", "typescript", { force: true });
    expect(result.rejected).toBe(false);
    expect(result.hints.some((h) => h.code === "BARE_ALTERNATION")).toBe(true);
  });

  it("double pipe || is not flagged", () => {
    // given: a pattern with || (logical or, not alternation)
    // when: validating
    // then: not flagged as alternation
    const result = validatePatternHints("a || b", "typescript");
    expect(result.hints.some((h) => h.code === "BARE_ALTERNATION")).toBe(false);
  });
});

// ---------- validatePatternHints: always-reject rules (force does NOT bypass) ----------

describe("validatePatternHints - always reject rules", () => {
  type AlwaysRejectCase = {
    name: string;
    pattern: string;
    language: string;
    opts?: ValidationOpts;
    code: string;
  };

  const cases: AlwaysRejectCase[] = [
    { name: "empty pattern", pattern: "", language: "typescript", code: "PATTERN_EMPTY" },
    { name: "whitespace-only pattern", pattern: "   ", language: "typescript", code: "PATTERN_EMPTY" },
    { name: "unsupported language", pattern: "foo", language: "brainfuck", code: "LANGUAGE_UNSUPPORTED" },
    { name: "invalid path - empty string", pattern: "foo", language: "typescript", opts: { paths: "" }, code: "INVALID_PATH" },
    { name: "invalid path - empty array", pattern: "foo", language: "typescript", opts: { paths: [] }, code: "INVALID_PATH" },
    { name: "invalid limit - negative", pattern: "foo", language: "typescript", opts: { limit: -1 }, code: "INVALID_LIMIT" },
    { name: "invalid limit - zero", pattern: "foo", language: "typescript", opts: { limit: 0 }, code: "INVALID_LIMIT" },
    { name: "invalid limit - NaN", pattern: "foo", language: "typescript", opts: { limit: NaN }, code: "INVALID_LIMIT" },
    { name: "invalid limit - Infinity", pattern: "foo", language: "typescript", opts: { limit: Infinity }, code: "INVALID_LIMIT" },
  ];

  for (const c of cases) {
    it(`${c.name} - rejected without force`, () => {
      // given: a pattern with an always-reject issue
      // when: validating without force
      // then: rejected with the specific always-reject code
      const result = validatePatternHints(c.pattern, c.language, c.opts);
      expect(result.rejected).toBe(true);
      expect(result.ok).toBe(false);
      expect(result.code).toBe(c.code);
    });

    it(`${c.name} - force=true does NOT bypass`, () => {
      // given: a pattern with an always-reject issue
      // when: validating with force=true
      // then: still rejected with the same code
      const result = validatePatternHints(c.pattern, c.language, { ...c.opts, force: true });
      expect(result.rejected).toBe(true);
      expect(result.code).toBe(c.code);
    });
  }
});

// ---------- validatePatternHints: happy paths ----------

describe("validatePatternHints - happy paths", () => {
  type HappyCase = {
    name: string;
    pattern: string;
    language: string;
  };

  const cases: HappyCase[] = [
    { name: "console.log with metavar", pattern: "console.log($MSG)", language: "typescript" },
    { name: "function with body", pattern: "function $NAME($$$ARGS) { $$$BODY }", language: "typescript" },
    { name: "python def without trailing colon", pattern: "def $FUNC($$$)", language: "python" },
    { name: "go func with body", pattern: "func $NAME($$$) { $$$ }", language: "go" },
    { name: "rust fn with body", pattern: "fn $NAME($$$) -> $RET { $$$ }", language: "rust" },
    { name: "alias ts -> typescript", pattern: "console.log($MSG)", language: "ts" },
    { name: "alias py -> python", pattern: "def $FUNC($$$)", language: "py" },
    { name: "alias js -> javascript", pattern: "function $NAME($$$) { $$$ }", language: "js" },
  ];

  for (const c of cases) {
    it(c.name, () => {
      // given: a valid pattern for the given language
      // when: validating
      // then: ok, no rejection
      const result = validatePatternHints(c.pattern, c.language);
      expect(result.ok).toBe(true);
      expect(result.rejected).toBe(false);
      expect(result.code).toBeNull();
    });
  }
});

// ---------- validateRewriteHints ----------

describe("validateRewriteHints", () => {
  it("unbound metavar in rewrite - rejected even with force", () => {
    // given: pattern captures $A, rewrite uses $B (not in pattern)
    // when: validating with force=true
    // then: always-rejected with REWRITE_UNBOUND_METAVARIABLE
    const result = validateRewriteHints("console.log($A)", "$B", "typescript", { force: true });
    expect(result.rejected).toBe(true);
    expect(result.code).toBe("REWRITE_UNBOUND_METAVARIABLE");
  });

  it("cardinality mismatch single-to-multi - rejected even with force", () => {
    // given: pattern has $ARGS (single), rewrite has $$$ARGS (multi)
    // when: validating with force=true
    // then: always-rejected with REWRITE_CARDINALITY_MISMATCH
    const result = validateRewriteHints("foo($ARGS)", "bar($$$ARGS)", "typescript", { force: true });
    expect(result.rejected).toBe(true);
    expect(result.code).toBe("REWRITE_CARDINALITY_MISMATCH");
  });

  it("cardinality mismatch multi-to-single - rejected", () => {
    // given: pattern has $$$ARGS (multi), rewrite has $ARGS (single)
    // when: validating
    // then: always-rejected with REWRITE_CARDINALITY_MISMATCH
    const result = validateRewriteHints("foo($$$ARGS)", "bar($ARGS)", "typescript");
    expect(result.rejected).toBe(true);
    expect(result.code).toBe("REWRITE_CARDINALITY_MISMATCH");
  });

  it("happy rewrite - ok", () => {
    // given: pattern and rewrite with matching metavars
    // when: validating
    // then: ok, not rejected
    const result = validateRewriteHints("console.log($MSG)", "logger.info($MSG)", "typescript");
    expect(result.ok).toBe(true);
    expect(result.rejected).toBe(false);
    expect(result.code).toBeNull();
  });

  it("happy rewrite with multi - ok", () => {
    // given: pattern and rewrite with matching multi metavars
    // when: validating
    // then: ok
    const result = validateRewriteHints("foo($$$ARGS)", "bar($$$ARGS)", "typescript");
    expect(result.ok).toBe(true);
  });

  it("rewrite with empty replacement (deletion) - ok", () => {
    // given: pattern with metavars, empty rewrite (deletion)
    // when: validating
    // then: ok (empty rewrite is valid, no metavars needed)
    const result = validateRewriteHints("console.log($MSG)", "", "typescript");
    expect(result.ok).toBe(true);
  });

  it("rewrite propagates pattern hint rejection", () => {
    // given: pattern has regex misuse (hard-reject), rewrite has no metavars
    // when: validating without force
    // then: rejected with PATTERN_HINT_REJECTED
    const result = validateRewriteHints("\\w+", "console.log(42)", "typescript");
    expect(result.rejected).toBe(true);
    expect(result.code).toBe("PATTERN_HINT_REJECTED");
  });

  it("rewrite force bypasses pattern hints but not unbound", () => {
    // given: pattern has regex misuse AND rewrite has unbound metavar
    // when: validating with force=true
    // then: still rejected (unbound is always-reject)
    const result = validateRewriteHints("\\w+", "$B", "typescript", { force: true });
    expect(result.rejected).toBe(true);
    expect(result.code).toBe("REWRITE_UNBOUND_METAVARIABLE");
  });

  it("rewrite force bypasses pattern hints with valid rewrite", () => {
    // given: pattern has regex misuse, rewrite has no metavars
    // when: validating with force=true
    // then: ok (pattern hint bypassed, rewrite valid)
    const result = validateRewriteHints("\\w+", "console.log(42)", "typescript", { force: true });
    expect(result.ok).toBe(true);
  });

  it("rewrite empty pattern - always rejected", () => {
    // given: empty pattern
    // when: validating rewrite
    // then: rejected with PATTERN_EMPTY
    const result = validateRewriteHints("", "$A", "typescript");
    expect(result.rejected).toBe(true);
    expect(result.code).toBe("PATTERN_EMPTY");
  });
});

// ---------- coverage gap regressions (AdversarialVerify) ----------

describe("coverage gap 1: metavar name validation (mixed-case)", () => {
  type Case = { name: string; pattern: string; shouldReject: boolean };
  const cases: Case[] = [
    { name: "$Foo rejected (capital then lower)", pattern: "console.log($Foo)", shouldReject: true },
    { name: "$Afoo rejected (upper then lower)", pattern: "console.log($Afoo)", shouldReject: true },
    { name: "$foo rejected (all lower)", pattern: "console.log($foo)", shouldReject: true },
    { name: "$MSG accepted (all caps)", pattern: "console.log($MSG)", shouldReject: false },
    { name: "$_ accepted (wildcard)", pattern: "console.log($_)", shouldReject: false },
    { name: "$$$ARGS accepted (multi all caps)", pattern: "foo($$$ARGS)", shouldReject: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      // given: a pattern with a metavar-shaped token
      // when: validating without force
      // then: mixed-case names rejected, all-caps/wildcard accepted
      const result = validatePatternHints(c.pattern, "typescript");
      if (c.shouldReject) {
        expect(result.rejected).toBe(true);
        expect(result.code).toBe("PATTERN_HINT_REJECTED");
        expect(result.hints.some((h) => h.code === "INVALID_METAVAR_NAME")).toBe(true);
      } else {
        expect(result.ok).toBe(true);
        expect(result.hints.some((h) => h.code === "INVALID_METAVAR_NAME")).toBe(false);
      }
    });
  }

  it("$Foo force=true bypasses", () => {
    // given: mixed-case metavar name
    // when: force=true
    // then: bypassed but hint still present
    const result = validatePatternHints("console.log($Foo)", "typescript", { force: true });
    expect(result.ok).toBe(true);
    expect(result.hints.some((h) => h.code === "INVALID_METAVAR_NAME")).toBe(true);
  });
});

describe("coverage gap 2: bare-pipe warning for metavar/call operands", () => {
  it("'$A | $B' warns BARE_ALTERNATION", () => {
    // given: alternation between metavar-shaped tokens
    // when: validating
    // then: BARE_ALTERNATION hint present, not rejected
    const result = validatePatternHints("$A | $B", "typescript");
    expect(result.hints.some((h) => h.code === "BARE_ALTERNATION")).toBe(true);
    expect(result.rejected).toBe(false);
  });

  it("'foo() | bar()' warns BARE_ALTERNATION", () => {
    // given: alternation between call expressions
    // when: validating
    // then: BARE_ALTERNATION hint present, not rejected
    const result = validatePatternHints("foo() | bar()", "typescript");
    expect(result.hints.some((h) => h.code === "BARE_ALTERNATION")).toBe(true);
    expect(result.rejected).toBe(false);
  });
});

describe("coverage gap 3: incomplete function forms with params but no body", () => {
  type FormCase = { name: string; pattern: string; language: string };
  const cases: FormCase[] = [
    { name: "JS function foo() no body", pattern: "function foo()", language: "javascript" },
    { name: "TS function foo() no body", pattern: "function foo()", language: "typescript" },
    { name: "Go func foo() no body", pattern: "func foo()", language: "go" },
    { name: "Rust fn foo() no body", pattern: "fn foo()", language: "rust" },
  ];
  for (const c of cases) {
    it(`${c.name} - rejected without force`, () => {
      // given: a function declaration with params but no body braces
      // when: validating without force
      // then: rejected with PATTERN_HINT_REJECTED + PATTERN_INCOMPLETE_FORM
      const result = validatePatternHints(c.pattern, c.language);
      expect(result.rejected).toBe(true);
      expect(result.code).toBe("PATTERN_HINT_REJECTED");
      expect(result.hints.some((h) => h.code === "PATTERN_INCOMPLETE_FORM")).toBe(true);
    });
    it(`${c.name} - force=true bypasses`, () => {
      // given: same incomplete form
      // when: force=true
      // then: bypassed but hint present
      const result = validatePatternHints(c.pattern, c.language, { force: true });
      expect(result.ok).toBe(true);
      expect(result.hints.some((h) => h.code === "PATTERN_INCOMPLETE_FORM")).toBe(true);
    });
  }

  it("JS function with body braces is accepted", () => {
    // given: a complete function with body
    // when: validating
    // then: no incomplete-form hint
    const result = validatePatternHints("function foo() { $$$ }", "javascript");
    expect(result.ok).toBe(true);
    expect(result.hints.some((h) => h.code === "PATTERN_INCOMPLETE_FORM")).toBe(false);
  });
});

describe("coverage gap 4: character-class detection breadth (round 2 decision table)", () => {
  type CharCase = { name: string; pattern: string; shouldDetect: boolean };
  const cases: CharCase[] = [
    // MUST FIRE — regex char classes
    { name: "[a_] detected", pattern: "[a_]", shouldDetect: true },
    { name: "[^a-z] detected (negated class)", pattern: "[^a-z]", shouldDetect: true },
    { name: "[a. ] detected (dot+space)", pattern: "[a. ]", shouldDetect: true },
    { name: "[a-z] detected (hyphen range)", pattern: "[a-z]", shouldDetect: true },
    { name: "[A-Z0-9_] detected", pattern: "[A-Z0-9_]", shouldDetect: true },
    // MUST NOT FIRE — valid TypeScript/code patterns
    { name: "[a, b] not detected (tuple/array literal)", pattern: "[a, b]", shouldDetect: false },
    { name: "const x = [a, b] not detected", pattern: "const x = [a, b]", shouldDetect: false },
    { name: "const [a, b] = pair not detected (destructuring)", pattern: "const [a, b] = pair", shouldDetect: false },
    { name: "obj[foo_bar] not detected (computed index)", pattern: "obj[foo_bar]", shouldDetect: false },
    { name: "type T = [A, B] not detected (tuple type)", pattern: "type T = [A, B]", shouldDetect: false },
    { name: "arr[0] not detected (indexing)", pattern: "arr[0]", shouldDetect: false },
    { name: "obj[\"key\"] not detected (string index)", pattern: "obj[\"key\"]", shouldDetect: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      // given: a pattern that may or may not be a regex char class
      // when: validating
      // then: REGEX_CHAR_CLASS hint present iff shouldDetect
      const result = validatePatternHints(c.pattern, "typescript");
      const hasHint = result.hints.some((h) => h.code === "REGEX_CHAR_CLASS");
      expect(hasHint).toBe(c.shouldDetect);
      if (c.shouldDetect) {
        expect(result.rejected).toBe(true);
        expect(result.code).toBe("PATTERN_HINT_REJECTED");
      }
    });
  }

  it("[a_] force=true bypasses", () => {
    // given: char class with underscore
    // when: force=true
    // then: bypassed but hint present
    const result = validatePatternHints("[a_]", "typescript", { force: true });
    expect(result.ok).toBe(true);
    expect(result.hints.some((h) => h.code === "REGEX_CHAR_CLASS")).toBe(true);
  });

  // Round 3: external caret leak + mixed alnum range
  type Round3Case = { name: string; pattern: string; shouldDetect: boolean };
  const round3: Round3Case[] = [
    { name: "^[a-z] NOT detected (external caret)", pattern: "^[a-z]", shouldDetect: false },
    { name: "^[a_] NOT detected (external caret)", pattern: "^[a_]", shouldDetect: false },
    { name: "[0-Z] detected (mixed alnum range)", pattern: "[0-Z]", shouldDetect: true },
    { name: "[a-z] control still detected", pattern: "[a-z]", shouldDetect: true },
  ];
  for (const c of round3) {
    it(`round 3: ${c.name}`, () => {
      // given: a pattern with or without an external caret or mixed alnum range
      // when: validating
      // then: REGEX_CHAR_CLASS hint present iff shouldDetect
      const result = validatePatternHints(c.pattern, "typescript");
      const hasHint = result.hints.some((h) => h.code === "REGEX_CHAR_CLASS");
      expect(hasHint).toBe(c.shouldDetect);
    });
  }
});

// ---------- adversarial inputs ----------

describe("adversarial inputs", () => {
  it("17KB pattern does not crash", () => {
    // given: a very long pattern (17KB)
    // when: validating
    // then: does not crash, validates normally
    const longPattern = "console.log(" + "A".repeat(17000) + ")";
    const result = validatePatternHints(longPattern, "typescript");
    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
  });

  it("non-string language is rejected", () => {
    // given: a non-string language value (adversarial runtime input)
    // when: validating
    // then: rejected with LANGUAGE_UNSUPPORTED
    const result = validatePatternHints("foo", 42 as unknown as string);
    expect(result.rejected).toBe(true);
    expect(result.code).toBe("LANGUAGE_UNSUPPORTED");
  });

  it("unicode in pattern is handled", () => {
    // given: a pattern with unicode characters
    // when: validating
    // then: ok (unicode is valid in patterns)
    const result = validatePatternHints('console.log("héllo")', "typescript");
    expect(result.ok).toBe(true);
  });

  it("unicode metavar adjacent text is handled", () => {
    // given: a pattern with unicode in the code (not in metavar name)
    // when: validating
    // then: ok
    const result = validatePatternHints("const $X = 'café'", "typescript");
    expect(result.ok).toBe(true);
  });
});
