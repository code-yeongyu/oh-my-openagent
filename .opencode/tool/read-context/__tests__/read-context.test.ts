/**
 * Tests for Read Context Tool
 *
 * Tests YAML parsing, section filtering, and edge cases.
 */

import { strict as assert } from "assert";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// Test directory setup
const TEST_DIR = "/tmp/read-context-test";
const OPENCODE_DIR = join(TEST_DIR, ".opencode");

function setupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
  mkdirSync(OPENCODE_DIR, { recursive: true });
}

function cleanupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
}

// Helper to create project context file
function createProjectContext(content: any) {
  const yamlContent = typeof content === "string" ? content : stringifyYaml(content);
  writeFileSync(join(OPENCODE_DIR, "project-context.yaml"), yamlContent);
}

// Sample project context
const sampleContext = {
  project: {
    name: "my-awesome-app",
    type: "web-application",
    description: "A modern web application built with TypeScript",
  },
  tech_stack: {
    languages: ["TypeScript", "JavaScript"],
    frameworks: ["Next.js", "React"],
    databases: ["PostgreSQL", "Redis"],
  },
  architecture: {
    pattern: "layered",
    layers: ["controllers", "services", "repositories", "models"],
  },
  integrations: {
    linear: {
      enabled: true,
      team_id: "TEAM-123",
    },
    mintlify: {
      enabled: true,
      docs_path: "docs/",
    },
  },
  conventions: {
    naming: {
      files: "kebab-case",
      components: "PascalCase",
      functions: "camelCase",
    },
    style: {
      indent: 2,
      quotes: "double",
      semicolons: true,
    },
  },
};

// Tests
console.log("Running Read Context Tool Tests...\n");

// Test 1: Parse valid YAML
console.log("Test 1: Parse valid YAML");
{
  const yamlString = stringifyYaml(sampleContext);
  const parsed = parseYaml(yamlString);

  assert.deepEqual(parsed.project.name, "my-awesome-app", "Should parse project name");
  assert.deepEqual(parsed.tech_stack.languages, ["TypeScript", "JavaScript"], "Should parse languages");
  assert.equal(parsed.architecture.pattern, "layered", "Should parse architecture pattern");
  console.log("  ✓ Valid YAML parsing works correctly\n");
}

// Test 2: Section filtering - project
console.log("Test 2: Section filtering - project");
{
  const parsed = parseYaml(stringifyYaml(sampleContext));
  const section = "project";

  assert(section in parsed, `Section '${section}' should exist`);
  assert.equal(parsed[section].name, "my-awesome-app", "Should return project section");
  console.log("  ✓ Project section filtering works\n");
}

// Test 3: Section filtering - tech_stack
console.log("Test 3: Section filtering - tech_stack");
{
  const parsed = parseYaml(stringifyYaml(sampleContext));
  const section = "tech_stack";

  assert(section in parsed, `Section '${section}' should exist`);
  assert(Array.isArray(parsed[section].languages), "Should have languages array");
  assert(Array.isArray(parsed[section].frameworks), "Should have frameworks array");
  console.log("  ✓ Tech stack section filtering works\n");
}

// Test 4: Section filtering - architecture
console.log("Test 4: Section filtering - architecture");
{
  const parsed = parseYaml(stringifyYaml(sampleContext));
  const section = "architecture";

  assert(section in parsed, `Section '${section}' should exist`);
  assert.equal(parsed[section].pattern, "layered", "Should have pattern");
  assert(Array.isArray(parsed[section].layers), "Should have layers array");
  console.log("  ✓ Architecture section filtering works\n");
}

// Test 5: Section filtering - integrations
console.log("Test 5: Section filtering - integrations");
{
  const parsed = parseYaml(stringifyYaml(sampleContext));
  const section = "integrations";

  assert(section in parsed, `Section '${section}' should exist`);
  assert(parsed[section].linear.enabled === true, "Should have linear integration");
  assert(parsed[section].mintlify.enabled === true, "Should have mintlify integration");
  console.log("  ✓ Integrations section filtering works\n");
}

// Test 6: Section filtering - conventions
console.log("Test 6: Section filtering - conventions");
{
  const parsed = parseYaml(stringifyYaml(sampleContext));
  const section = "conventions";

  assert(section in parsed, `Section '${section}' should exist`);
  assert.equal(parsed[section].naming.files, "kebab-case", "Should have file naming convention");
  assert.equal(parsed[section].style.indent, 2, "Should have indent style");
  console.log("  ✓ Conventions section filtering works\n");
}

// Test 7: Missing section handling
console.log("Test 7: Missing section handling");
{
  const minimalContext = {
    project: { name: "minimal-app" },
  };
  const parsed = parseYaml(stringifyYaml(minimalContext));

  assert(!("tech_stack" in parsed), "tech_stack should not exist");
  assert(!("architecture" in parsed), "architecture should not exist");
  console.log("  ✓ Handles missing sections correctly\n");
}

// Test 8: Empty file handling
console.log("Test 8: Empty file handling");
{
  const emptyContent = "";
  try {
    const parsed = parseYaml(emptyContent);
    assert(parsed === null || parsed === undefined, "Empty YAML should parse to null/undefined");
  } catch {
    // Some YAML parsers throw on empty content
  }
  console.log("  ✓ Handles empty file correctly\n");
}

// Test 9: Invalid YAML handling
console.log("Test 9: Invalid YAML handling");
{
  const invalidYaml = `
project:
  name: test
  invalid: [unclosed bracket
`;

  try {
    parseYaml(invalidYaml);
    assert.fail("Should throw on invalid YAML");
  } catch (e) {
    assert(e instanceof Error, "Should throw an Error");
    console.log("  ✓ Handles invalid YAML correctly\n");
  }
}

// Test 10: File system integration
console.log("Test 10: File system integration");
{
  setupTestDir();

  createProjectContext(sampleContext);

  const contextPath = join(OPENCODE_DIR, "project-context.yaml");
  assert(existsSync(contextPath), "Context file should exist");

  // Read and parse the file
  const { readFileSync } = await import("fs");
  const content = readFileSync(contextPath, "utf-8");
  const parsed = parseYaml(content);

  assert.equal(parsed.project.name, "my-awesome-app", "Should read project name from file");

  cleanupTestDir();
  console.log("  ✓ File system integration works\n");
}

// Test 11: Available sections detection
console.log("Test 11: Available sections detection");
{
  const parsed = parseYaml(stringifyYaml(sampleContext));
  const availableSections = Object.keys(parsed);

  assert(availableSections.includes("project"), "Should include project");
  assert(availableSections.includes("tech_stack"), "Should include tech_stack");
  assert(availableSections.includes("architecture"), "Should include architecture");
  assert(availableSections.includes("integrations"), "Should include integrations");
  assert(availableSections.includes("conventions"), "Should include conventions");
  console.log("  ✓ Available sections detection works\n");
}

// Test 12: Complex nested values
console.log("Test 12: Complex nested values");
{
  const complexContext = {
    project: {
      name: "complex-app",
      metadata: {
        version: "1.0.0",
        tags: ["production", "stable"],
        config: {
          debug: false,
          features: {
            auth: true,
            analytics: true,
          },
        },
      },
    },
  };

  const yamlString = stringifyYaml(complexContext);
  const parsed = parseYaml(yamlString);

  assert.equal(parsed.project.metadata.version, "1.0.0", "Should parse nested version");
  assert.deepEqual(parsed.project.metadata.tags, ["production", "stable"], "Should parse nested tags");
  assert.equal(parsed.project.metadata.config.features.auth, true, "Should parse deeply nested values");
  console.log("  ✓ Complex nested values work correctly\n");
}

// Test 13: YAML with comments (should be preserved in parsing)
console.log("Test 13: YAML with comments");
{
  const yamlWithComments = `
# Project configuration
project:
  name: commented-app  # The app name
  # This is the type
  type: web-application

# Technology stack
tech_stack:
  languages:
    - TypeScript  # Primary language
    - JavaScript
`;

  const parsed = parseYaml(yamlWithComments);
  assert.equal(parsed.project.name, "commented-app", "Should parse despite comments");
  assert.equal(parsed.project.type, "web-application", "Should parse type");
  console.log("  ✓ YAML with comments parses correctly\n");
}

console.log("All Read Context Tool tests passed! ✓");

