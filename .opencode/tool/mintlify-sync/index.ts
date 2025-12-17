import { tool } from "@opencode-ai/plugin";
import { execSync } from "child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * Mintlify Sync Tool
 *
 * Synchronize documentation changes to Mintlify, validate structure,
 * and ensure docs are properly formatted.
 */

interface ValidationStats {
  totalFiles: number;
  validFiles: number;
  navigationItems: number;
}

interface ValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  stats: ValidationStats;
  message?: string;
  suggestion?: string;
  details?: string;
}

interface FileValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface MintConfig {
  navigation?: NavigationItem[];
  [key: string]: unknown;
}

type NavigationItem = string | { group?: string; pages?: NavigationItem[] };

/**
 * Recursively find all MDX and MD files in a directory.
 */
function findMdxFiles(dir: string): string[] {
  const files: string[] = [];

  if (!existsSync(dir)) {
    return files;
  }

  const items = readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const path = join(dir, item.name);
    if (item.isDirectory()) {
      // Skip node_modules and hidden directories
      if (!item.name.startsWith(".") && item.name !== "node_modules") {
        files.push(...findMdxFiles(path));
      }
    } else if (item.name.endsWith(".mdx") || item.name.endsWith(".md")) {
      files.push(path);
    }
  }

  return files;
}

/**
 * Validate an MDX file for proper structure.
 */
function validateMdxFile(filePath: string): FileValidation {
  const content = readFileSync(filePath, "utf-8");
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for frontmatter
  if (!content.startsWith("---")) {
    errors.push("Missing frontmatter");
  } else {
    // Extract and validate frontmatter
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

  // Check for empty content
  const bodyContent = content.replace(/^---[\s\S]*?---/, "").trim();
  if (bodyContent.length < 50) {
    warnings.push("Very short content (< 50 chars)");
  }

  // Check for broken internal links
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = linkPattern.exec(content)) !== null) {
    const linkPath = match[2];
    if (linkPath.startsWith("/") && !linkPath.startsWith("http")) {
      // Internal link - flag for verification
      warnings.push(`Internal link: ${linkPath} (verify exists)`);
    }
  }

  // Check for common issues
  if (content.includes("TODO") || content.includes("FIXME")) {
    warnings.push("Contains TODO/FIXME comments");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Count navigation items recursively.
 */
function countNavItems(nav: NavigationItem[]): number {
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

/**
 * Extract file paths from navigation structure.
 */
function extractNavFiles(nav: NavigationItem[]): string[] {
  const files: string[] = [];
  for (const item of nav) {
    if (typeof item === "string") {
      files.push(item);
    } else if (item.pages) {
      files.push(...extractNavFiles(item.pages));
    }
  }
  return files;
}

/**
 * Normalize a file path for comparison with navigation entries.
 */
function normalizeForNav(filePath: string, docsPath: string): string {
  // Remove docs path prefix and file extension
  let normalized = relative(docsPath, filePath);
  normalized = normalized.replace(/\.(mdx?|md)$/, "");
  return normalized;
}

export default tool({
  description:
    "Validate and sync documentation to Mintlify. Use after creating or updating documentation.",

  args: {
    action: tool.schema
      .enum(["validate", "sync", "preview"])
      .describe(
        "Action to perform: validate (check structure), sync (push to Mintlify), preview (local preview)"
      ),

    docsPath: tool.schema
      .string()
      .optional()
      .describe("Path to docs directory (default: docs/)"),
  },

  async execute(args): Promise<string> {
    const docsPath = args.docsPath || "docs/";
    const action = args.action;

    // Check if docs directory exists
    if (!existsSync(docsPath)) {
      const result: ValidationResult = {
        success: false,
        errors: [`Documentation directory not found: ${docsPath}`],
        warnings: [],
        stats: { totalFiles: 0, validFiles: 0, navigationItems: 0 },
        suggestion: "Run /init-project to set up Mintlify structure",
      };
      return JSON.stringify(result, null, 2);
    }

    // Check for mint.json
    const mintConfigPath = join(docsPath, "mint.json");
    if (!existsSync(mintConfigPath)) {
      const result: ValidationResult = {
        success: false,
        errors: ["mint.json not found in docs directory"],
        warnings: [],
        stats: { totalFiles: 0, validFiles: 0, navigationItems: 0 },
        suggestion: "Create mint.json with Mintlify configuration",
      };
      return JSON.stringify(result, null, 2);
    }

    const results: ValidationResult = {
      success: true,
      errors: [],
      warnings: [],
      stats: {
        totalFiles: 0,
        validFiles: 0,
        navigationItems: 0,
      },
    };

    try {
      // Parse mint.json
      const mintConfigContent = readFileSync(mintConfigPath, "utf-8");
      let mintConfig: MintConfig;

      try {
        mintConfig = JSON.parse(mintConfigContent);
      } catch {
        const result: ValidationResult = {
          success: false,
          errors: ["Invalid JSON in mint.json"],
          warnings: [],
          stats: { totalFiles: 0, validFiles: 0, navigationItems: 0 },
          suggestion: "Fix JSON syntax errors in mint.json",
        };
        return JSON.stringify(result, null, 2);
      }

      // Validate navigation structure
      const navItems = countNavItems(mintConfig.navigation || []);
      results.stats.navigationItems = navItems;

      // Scan for MDX files
      const mdxFiles = findMdxFiles(docsPath);
      results.stats.totalFiles = mdxFiles.length;

      // Validate each file
      for (const file of mdxFiles) {
        const validation = validateMdxFile(file);
        if (validation.valid) {
          results.stats.validFiles++;
        } else {
          results.errors.push(
            ...validation.errors.map((e) => `${relative(docsPath, file)}: ${e}`)
          );
        }
        results.warnings.push(
          ...validation.warnings.map((w) => `${relative(docsPath, file)}: ${w}`)
        );
      }

      // Check for orphaned files (not in navigation)
      const navFiles = extractNavFiles(mintConfig.navigation || []);
      const normalizedMdxFiles = mdxFiles.map((f) => normalizeForNav(f, docsPath));
      const orphaned = normalizedMdxFiles.filter(
        (f) => !navFiles.some((nf) => nf === f || nf.endsWith(f) || f.endsWith(nf))
      );
      if (orphaned.length > 0) {
        results.warnings.push(
          `Orphaned files (not in navigation): ${orphaned.join(", ")}`
        );
      }

      // Action-specific handling
      if (action === "validate") {
        results.success = results.errors.length === 0;
        results.message = results.success
          ? `Documentation is valid. ${results.stats.validFiles}/${results.stats.totalFiles} files passed validation.`
          : `Validation failed with ${results.errors.length} error(s).`;
        return JSON.stringify(results, null, 2);
      }

      if (action === "preview") {
        try {
          // Check if mintlify is available
          try {
            execSync("npx mintlify --version", {
              cwd: docsPath,
              stdio: "pipe",
            });
          } catch {
            const result: ValidationResult = {
              success: false,
              errors: ["Mintlify CLI not found"],
              warnings: [],
              stats: results.stats,
              suggestion: "Run: npm install -g mintlify",
            };
            return JSON.stringify(result, null, 2);
          }

          // Start preview server (this would typically be run in background)
          results.success = true;
          results.message =
            "To start Mintlify preview, run: npx mintlify dev --port 3333";
          results.details = `Preview server can be started in the ${docsPath} directory`;
          return JSON.stringify(results, null, 2);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          const result: ValidationResult = {
            success: false,
            errors: [`Failed to start preview server: ${errorMessage}`],
            warnings: [],
            stats: results.stats,
            suggestion: "Run: npm install -g mintlify",
          };
          return JSON.stringify(result, null, 2);
        }
      }

      if (action === "sync") {
        // Validate first
        if (results.errors.length > 0) {
          results.success = false;
          results.message = "Cannot sync: validation errors found";
          return JSON.stringify(results, null, 2);
        }

        // Check for mintlify CLI
        try {
          execSync("npx mintlify --version", {
            cwd: docsPath,
            stdio: "pipe",
          });
        } catch {
          const result: ValidationResult = {
            success: false,
            errors: ["Mintlify CLI not found"],
            warnings: results.warnings,
            stats: results.stats,
            suggestion: "Run: npm install -g mintlify",
          };
          return JSON.stringify(result, null, 2);
        }

        // Push to Mintlify (requires mintlify CLI and auth)
        try {
          execSync("npx mintlify deploy", {
            cwd: docsPath,
            stdio: "pipe",
          });
          results.success = true;
          results.message = "Documentation synced to Mintlify successfully";
          return JSON.stringify(results, null, 2);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          const result: ValidationResult = {
            success: false,
            errors: [`Failed to sync to Mintlify: ${errorMessage}`],
            warnings: results.warnings,
            stats: results.stats,
            suggestion: "Ensure you're authenticated: mintlify login",
          };
          return JSON.stringify(result, null, 2);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const result: ValidationResult = {
        success: false,
        errors: [`Mintlify sync failed: ${errorMessage}`],
        warnings: [],
        stats: { totalFiles: 0, validFiles: 0, navigationItems: 0 },
      };
      return JSON.stringify(result, null, 2);
    }

    return JSON.stringify(results, null, 2);
  },
});

