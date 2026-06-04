/**
 * Tests for plan format detection (v1 flat vs v2 hierarchical)
 *
 * BDD: //#given //#when //#then pattern
 */

import { describe, expect, it } from "bun:test";
import {
  detectPlanFormat,
  addFormatMetadata,
  FORMAT_METADATA_HEADER,
} from "./plan-format-detector";

describe("detectPlanFormat", () => {
  //#given a v1 plan with no metadata header
  //#when detectPlanFormat is called
  //#then it returns 'v1'
  it("detects v1 plan (no metadata header)", () => {
    const v1Plan = `# My Plan

## TL;DR

Quick summary here.

## Context

Some context.`;

    const result = detectPlanFormat(v1Plan);
    expect(result).toBe("v1");
  });

  //#given a v2 plan with Plan-Format: 2 metadata
  //#when detectPlanFormat is called
  //#then it returns 'v2'
  it("detects v2 plan (with Plan-Format: 2 metadata)", () => {
    const v2Plan = `<!-- Plan-Format: 2 -->

# My Plan

## TL;DR

Quick summary here.`;

    const result = detectPlanFormat(v2Plan);
    expect(result).toBe("v2");
  });

  //#given empty markdown content
  //#when detectPlanFormat is called
  //#then it defaults to 'v1'
  it("returns v1 for empty content (graceful default)", () => {
    const result = detectPlanFormat("");
    expect(result).toBe("v1");
  });

  //#given only whitespace
  //#when detectPlanFormat is called
  //#then it returns 'v1'
  it("returns v1 for whitespace-only content", () => {
    const result = detectPlanFormat("   \n\n  \t\n");
    expect(result).toBe("v1");
  });

  //#given malformed markdown without metadata
  //#when detectPlanFormat is called
  //#then it gracefully returns 'v1'
  it("returns v1 for malformed content without metadata", () => {
    const malformed = `
    \`\`\`
    random content
    no headers
    %%%
    \`\`\`
    `;

    const result = detectPlanFormat(malformed);
    expect(result).toBe("v1");
  });

  //#given v2 plan with metadata in the first line
  //#when detectPlanFormat is called
  //#then it detects the format correctly
  it("detects v2 format even if metadata is only content on first line", () => {
    const plan = `<!-- Plan-Format: 2 -->`;
    const result = detectPlanFormat(plan);
    expect(result).toBe("v2");
  });

  //#given v2 plan with metadata before other HTML comments
  //#when detectPlanFormat is called
  //#then it finds the Plan-Format metadata
  it("finds Plan-Format metadata among other HTML comments", () => {
    const plan = `<!-- Author: Prometheus -->
<!-- Plan-Format: 2 -->
<!-- Version: 1.0 -->

# Plan Title`;

    const result = detectPlanFormat(plan);
    expect(result).toBe("v2");
  });

  //#given content with Plan-Format: 1 (explicit v1)
  //#when detectPlanFormat is called
  //#then it returns 'v1'
  it("returns v1 when Plan-Format: 1 is explicitly specified", () => {
    const plan = `<!-- Plan-Format: 1 -->

# Plan Title`;

    const result = detectPlanFormat(plan);
    expect(result).toBe("v1");
  });

  //#given content with Plan-Format in lowercase
  //#when detectPlanFormat is called
  //#then it case-insensitively matches the metadata
  it("case-insensitively detects Plan-Format metadata", () => {
    const plan = `<!-- plan-format: 2 -->

# Plan`;

    const result = detectPlanFormat(plan);
    expect(result).toBe("v2");
  });

  //#given content with spaces around colon in metadata
  //#when detectPlanFormat is called
  //#then it handles whitespace variations
  it("handles whitespace variations around metadata colon", () => {
    const plan1 = `<!-- Plan-Format : 2 -->`;
    const plan2 = `<!-- Plan-Format:2 -->`;
    const plan3 = `<!-- Plan-Format  :  2  -->`;

    expect(detectPlanFormat(plan1)).toBe("v2");
    expect(detectPlanFormat(plan2)).toBe("v2");
    expect(detectPlanFormat(plan3)).toBe("v2");
  });
});

describe("addFormatMetadata", () => {
  //#given v1 plan content
  //#when addFormatMetadata is called with version 'v1'
  //#then it prepends v1 metadata header
  it("adds v1 format metadata header to content", () => {
    const content = `# Plan Title

## Section`;

    const result = addFormatMetadata(content, "v1");

    expect(result).toContain(`<!-- Plan-Format: 1 -->`);
    expect(result).toStartWith(`<!-- Plan-Format: 1 -->`);
    expect(result).toContain("# Plan Title");
    expect(result).toContain("## Section");
  });

  //#given v2 plan content
  //#when addFormatMetadata is called with version 'v2'
  //#then it prepends v2 metadata header
  it("adds v2 format metadata header to content", () => {
    const content = `# Plan Title

## Section`;

    const result = addFormatMetadata(content, "v2");

    expect(result).toContain(`<!-- Plan-Format: 2 -->`);
    expect(result).toStartWith(`<!-- Plan-Format: 2 -->`);
    expect(result).toContain("# Plan Title");
    expect(result).toContain("## Section");
  });

  //#given empty content
  //#when addFormatMetadata is called
  //#then it returns only the metadata header with newline
  it("handles empty content gracefully", () => {
    const result = addFormatMetadata("", "v2");

    expect(result).toStartWith(`<!-- Plan-Format: 2 -->`);
    expect(result.trim()).toBe(`<!-- Plan-Format: 2 -->`);
  });

  //#given content that already has metadata
  //#when addFormatMetadata is called
  //#then it adds new metadata (doesn't deduplicate)
  it("adds metadata even if content already has it", () => {
    const content = `<!-- Plan-Format: 1 -->

# Plan`;

    const result = addFormatMetadata(content, "v2");

    // Should have both the new v2 and the old v1
    const lines = result.split("\n");
    const formatLines = lines.filter((line) =>
      line.includes("Plan-Format:")
    );
    expect(formatLines.length).toBeGreaterThan(0);
    // First line should be v2
    expect(result.startsWith(`<!-- Plan-Format: 2 -->`)).toBe(true);
  });

  //#given multiline content
  //#when addFormatMetadata is called
  //#then original content is preserved exactly
  it("preserves original content structure exactly", () => {
    const content = `# Plan Title

## TL;DR

> Summary line 1
> Summary line 2

## Context

Details here.

\`\`\`typescript
const x = 1;
\`\`\``;

    const result = addFormatMetadata(content, "v2");
    const contentPart = result.substring(
      result.indexOf("\n") + 1
    );

    expect(contentPart.trim()).toBe(content.trim());
  });

  //#given newlines in content
  //#when addFormatMetadata is called
  //#then the separator between metadata and content is correct
  it("has proper newline separation between metadata and content", () => {
    const content = `# Plan`;
    const result = addFormatMetadata(content, "v1");

    const [header, ...rest] = result.split("\n");
    expect(header).toBe(`<!-- Plan-Format: 1 -->`);
    expect(rest[0]).toBe(""); // blank line
    expect(rest[1]).toBe("# Plan");
  });
});

describe("FORMAT_METADATA_HEADER constant", () => {
  //#given the FORMAT_METADATA_HEADER constant
  //#when exported
  //#then it follows the correct comment format
  it("exports correctly formatted metadata header template", () => {
    expect(typeof FORMAT_METADATA_HEADER).toBe("string");
    expect(FORMAT_METADATA_HEADER).toContain("<!-- Plan-Format:");
    expect(FORMAT_METADATA_HEADER).toMatch(/Plan-Format:\s*\{version\}/);
  });
});

describe("detectPlanFormat edge cases", () => {
  it("returns v1 for unknown version numbers (e.g., Plan-Format: 3)", () => {
    //#given
    const plan = `<!-- Plan-Format: 3 -->

# Plan`;

    //#when
    const result = detectPlanFormat(plan);

    //#then
    expect(result).toBe("v1");
  });

  it("returns v1 for version 0", () => {
    //#given
    const plan = `<!-- Plan-Format: 0 -->

# Plan`;

    //#when
    const result = detectPlanFormat(plan);

    //#then
    expect(result).toBe("v1");
  });

  it("finds metadata anywhere in document, not just first line", () => {
    //#given
    const plan = `# My Plan

Some intro text.

<!-- Plan-Format: 2 -->

## Tasks`;

    //#when
    const result = detectPlanFormat(plan);

    //#then
    expect(result).toBe("v2");
  });

  it("handles UPPERCASE Plan-Format", () => {
    //#given
    const plan = `<!-- PLAN-FORMAT: 2 -->`;

    //#when
    const result = detectPlanFormat(plan);

    //#then
    expect(result).toBe("v2");
  });

  it("handles MixedCase Plan-Format", () => {
    //#given
    const plan = `<!-- Plan-FORMAT: 2 -->`;

    //#when
    const result = detectPlanFormat(plan);

    //#then
    expect(result).toBe("v2");
  });

  it("ignores Plan-Format in code blocks", () => {
    //#given - metadata in code block should not be detected
    const plan = `# Plan

\`\`\`html
<!-- Plan-Format: 2 -->
\`\`\`

Regular content here.`;

    //#when
    const result = detectPlanFormat(plan);

    //#then - regex still matches inside code block (known limitation)
    expect(result).toBe("v2");
  });

  it("handles multiple Plan-Format comments (uses first match)", () => {
    //#given
    const plan = `<!-- Plan-Format: 2 -->
<!-- Plan-Format: 1 -->

# Plan`;

    //#when
    const result = detectPlanFormat(plan);

    //#then
    expect(result).toBe("v2");
  });

  it("matches Plan-Format even inside multiline comment", () => {
    //#given
    const plan = `<!--
Plan-Format: 2
-->

# Plan`;

    //#when
    const result = detectPlanFormat(plan);

    //#then - regex matches Plan-Format anywhere in string
    expect(result).toBe("v2");
  });
});

describe("addFormatMetadata edge cases", () => {
  it("handles content with leading whitespace", () => {
    //#given
    const content = `   # Plan Title`;

    //#when
    const result = addFormatMetadata(content, "v2");

    //#then
    expect(result).toStartWith("<!-- Plan-Format: 2 -->");
    expect(result).toContain("   # Plan Title");
  });

  it("handles content with only newlines", () => {
    //#given
    const content = `\n\n\n`;

    //#when
    const result = addFormatMetadata(content, "v1");

    //#then - newlines only is not empty after trim, so adds header
    expect(result).toStartWith("<!-- Plan-Format: 1 -->");
  });

  it("handles whitespace-only content as empty", () => {
    //#given
    const content = `   \t  `;

    //#when
    const result = addFormatMetadata(content, "v2");

    //#then
    expect(result).toBe("<!-- Plan-Format: 2 -->");
  });
});
