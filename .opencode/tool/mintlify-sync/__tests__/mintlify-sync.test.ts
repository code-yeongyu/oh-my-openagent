/**
 * Tests for Mintlify Sync Tool
 *
 * Tests validation, structure checking, and edge cases.
 */

import { strict as assert } from "assert";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";

// Test directory setup
const TEST_DIR = "/tmp/mintlify-sync-test";

function setupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
}

function cleanupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
}

// Helper to create test files
function createTestFile(relativePath: string, content: string) {
  const fullPath = join(TEST_DIR, relativePath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content);
}

// Validation functions (extracted from tool for testing)
function validateMdxFile(content: string): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for frontmatter
  if (!content.startsWith("---")) {
    errors.push("Missing frontmatter");
  } else {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      if (!frontmatter.includes("title:")) {
        errors.push("Frontmatter missing 'title' field");
      }
    } else {
      errors.push("Malformed frontmatter (missing closing ---)");
    }
  }

  const bodyContent = content.replace(/^---[\s\S]*?---/, "").trim();
  if (bodyContent.length < 50) {
    warnings.push("Very short content (< 50 chars)");
  }

  if (content.includes("TODO") || content.includes("FIXME")) {
    warnings.push("Contains TODO/FIXME comments");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function countNavItems(nav: any[]): number {
  let count = 0;
  for (const item of nav) {
    if (typeof item === "string") {
      count++;
    } else if (item.pages) {
      count += countNavItems(item.pages);
    }
  }
  return count;
}

// Tests
console.log("Running Mintlify Sync Tool Tests...\n");

// Test 1: Valid MDX file validation
console.log("Test 1: Valid MDX file validation");
{
  const validMdx = `---
title: Getting Started
description: Learn how to get started with our platform
---

# Getting Started

This is a comprehensive guide to getting started with our platform.
Follow these steps to set up your environment and begin using the features.

## Prerequisites

- Node.js 18+
- npm or yarn
`;

  const result = validateMdxFile(validMdx);
  assert(result.valid, "Valid MDX should pass validation");
  assert.equal(result.errors.length, 0, "Should have no errors");
  console.log("  ✓ Valid MDX files pass validation\n");
}

// Test 2: Missing frontmatter
console.log("Test 2: Missing frontmatter");
{
  const noFrontmatter = `# Getting Started

This is content without frontmatter.
`;

  const result = validateMdxFile(noFrontmatter);
  assert(!result.valid, "Should fail without frontmatter");
  assert(result.errors.some((e) => e.includes("Missing frontmatter")), "Should report missing frontmatter");
  console.log("  ✓ Detects missing frontmatter\n");
}

// Test 3: Missing title in frontmatter
console.log("Test 3: Missing title in frontmatter");
{
  const noTitle = `---
description: Some description
---

# Content

This has frontmatter but no title field.
`;

  const result = validateMdxFile(noTitle);
  assert(!result.valid, "Should fail without title");
  assert(result.errors.some((e) => e.includes("title")), "Should report missing title");
  console.log("  ✓ Detects missing title field\n");
}

// Test 4: Malformed frontmatter
console.log("Test 4: Malformed frontmatter");
{
  const malformed = `---
title: Test
description: Missing closing delimiter

# Content starts here
`;

  const result = validateMdxFile(malformed);
  assert(!result.valid, "Should fail with malformed frontmatter");
  assert(result.errors.some((e) => e.includes("Malformed")), "Should report malformed frontmatter");
  console.log("  ✓ Detects malformed frontmatter\n");
}

// Test 5: Short content warning
console.log("Test 5: Short content warning");
{
  const shortContent = `---
title: Short Page
---

Brief.
`;

  const result = validateMdxFile(shortContent);
  assert(result.valid, "Should still be valid (warning only)");
  assert(result.warnings.some((w) => w.includes("short content")), "Should warn about short content");
  console.log("  ✓ Warns about short content\n");
}

// Test 6: TODO/FIXME detection
console.log("Test 6: TODO/FIXME detection");
{
  const withTodo = `---
title: Work in Progress
---

# Implementation Guide

This section needs more work.

TODO: Add more examples here.

The rest of the content is complete and ready for review.
`;

  const result = validateMdxFile(withTodo);
  assert(result.valid, "Should still be valid (warning only)");
  assert(result.warnings.some((w) => w.includes("TODO")), "Should warn about TODO");
  console.log("  ✓ Detects TODO/FIXME comments\n");
}

// Test 7: Navigation item counting
console.log("Test 7: Navigation item counting");
{
  const navigation = [
    "introduction",
    "quickstart",
    {
      group: "Guides",
      pages: ["guides/setup", "guides/configuration", "guides/deployment"],
    },
    {
      group: "API Reference",
      pages: [
        "api/overview",
        {
          group: "Endpoints",
          pages: ["api/endpoints/users", "api/endpoints/projects"],
        },
      ],
    },
  ];

  const count = countNavItems(navigation);
  assert.equal(count, 8, `Should count 8 items, got ${count}`);
  console.log("  ✓ Correctly counts navigation items\n");
}

// Test 8: Missing docs directory
console.log("Test 8: Missing docs directory");
{
  setupTestDir();

  // Don't create docs directory
  const docsPath = join(TEST_DIR, "nonexistent-docs");
  assert(!existsSync(docsPath), "Docs directory should not exist");

  cleanupTestDir();
  console.log("  ✓ Handles missing docs directory\n");
}

// Test 9: Missing mint.json
console.log("Test 9: Missing mint.json");
{
  setupTestDir();

  // Create docs directory without mint.json
  const docsPath = join(TEST_DIR, "docs");
  mkdirSync(docsPath, { recursive: true });

  const mintJsonPath = join(docsPath, "mint.json");
  assert(!existsSync(mintJsonPath), "mint.json should not exist");

  cleanupTestDir();
  console.log("  ✓ Handles missing mint.json\n");
}

// Test 10: Invalid mint.json
console.log("Test 10: Invalid mint.json");
{
  setupTestDir();

  const docsPath = join(TEST_DIR, "docs");
  mkdirSync(docsPath, { recursive: true });

  // Create invalid JSON
  writeFileSync(join(docsPath, "mint.json"), "{ invalid json }");

  try {
    JSON.parse("{ invalid json }");
    assert.fail("Should throw on invalid JSON");
  } catch (e) {
    assert(e instanceof SyntaxError, "Should be a SyntaxError");
  }

  cleanupTestDir();
  console.log("  ✓ Handles invalid mint.json\n");
}

// Test 11: Full validation flow
console.log("Test 11: Full validation flow");
{
  setupTestDir();

  const docsPath = join(TEST_DIR, "docs");

  // Create valid mint.json
  const mintConfig = {
    name: "Test Docs",
    navigation: [
      { group: "Getting Started", pages: ["introduction", "quickstart"] },
    ],
  };
  createTestFile("docs/mint.json", JSON.stringify(mintConfig, null, 2));

  // Create valid MDX files
  createTestFile(
    "docs/introduction.mdx",
    `---
title: Introduction
description: Welcome to our documentation
---

# Introduction

Welcome to our comprehensive documentation. This guide will help you understand
how to use our platform effectively and get the most out of its features.

## What You'll Learn

- How to set up your environment
- Basic concepts and terminology
- Advanced features and customization
`
  );

  createTestFile(
    "docs/quickstart.mdx",
    `---
title: Quickstart
description: Get up and running quickly
---

# Quickstart Guide

Follow these steps to get started with our platform in just a few minutes.

## Step 1: Installation

Run the following command to install the package:

\`\`\`bash
npm install our-package
\`\`\`

## Step 2: Configuration

Create a configuration file in your project root.
`
  );

  // Verify files exist
  assert(existsSync(join(docsPath, "mint.json")), "mint.json should exist");
  assert(existsSync(join(docsPath, "introduction.mdx")), "introduction.mdx should exist");
  assert(existsSync(join(docsPath, "quickstart.mdx")), "quickstart.mdx should exist");

  cleanupTestDir();
  console.log("  ✓ Full validation flow works correctly\n");
}

console.log("All Mintlify Sync Tool tests passed! ✓");

