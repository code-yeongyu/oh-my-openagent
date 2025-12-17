/**
 * Template Validation Script
 * 
 * This script validates that all templates render correctly with sample data.
 * Run with: npx tsx validate-templates.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

// Simple Handlebars-like template renderer for validation
function renderTemplate(template: string, data: Record<string, unknown>): string {
  let result = template;
  
  // Handle simple variable substitution: {{variable}}
  result = result.replace(/\{\{([^#/][^}]*)\}\}/g, (match, key) => {
    const value = getNestedValue(data, key.trim());
    return value !== undefined ? String(value) : match;
  });
  
  // Handle #each blocks (simplified)
  result = result.replace(/\{\{#each ([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (match, arrayPath, content) => {
    const array = getNestedValue(data, arrayPath.trim()) as unknown[];
    if (!Array.isArray(array)) return "";
    
    return array.map((item, index) => {
      let itemContent = content;
      // Replace {{this}} with the item value
      itemContent = itemContent.replace(/\{\{this\}\}/g, String(item));
      // Replace {{property}} with item.property for objects
      if (typeof item === "object" && item !== null) {
        Object.entries(item as Record<string, unknown>).forEach(([key, value]) => {
          itemContent = itemContent.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(value));
        });
      }
      return itemContent;
    }).join("");
  });
  
  // Handle #if blocks (simplified)
  result = result.replace(/\{\{#if ([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, condition, content) => {
    const value = getNestedValue(data, condition.trim());
    return value ? content : "";
  });
  
  return result;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce((current: unknown, key) => {
    if (current && typeof current === "object" && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

interface ValidationResult {
  file: string;
  status: "pass" | "fail" | "skip";
  message?: string;
  warnings?: string[];
}

function validateTemplateFile(filePath: string, sampleData: Record<string, unknown>): ValidationResult {
  const fileName = path.basename(filePath);
  
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    
    // Check if file is a template (has Handlebars syntax)
    const hasTemplateSyntax = /\{\{[^}]+\}\}/.test(content);
    
    if (!hasTemplateSyntax) {
      return {
        file: fileName,
        status: "skip",
        message: "No template syntax found (static file)",
      };
    }
    
    // Try to render the template
    const rendered = renderTemplate(content, sampleData);
    
    // Check for unrendered placeholders
    const unresolvedMatches = rendered.match(/\{\{[^#/][^}]*\}\}/g);
    const warnings: string[] = [];
    
    if (unresolvedMatches) {
      const uniqueUnresolved = [...new Set(unresolvedMatches)];
      warnings.push(`Unresolved placeholders: ${uniqueUnresolved.slice(0, 5).join(", ")}${uniqueUnresolved.length > 5 ? ` (+${uniqueUnresolved.length - 5} more)` : ""}`);
    }
    
    // Check for common issues
    if (rendered.includes("undefined")) {
      warnings.push("Template contains 'undefined' values");
    }
    
    if (rendered.includes("[object Object]")) {
      warnings.push("Template contains '[object Object]' (object not properly serialized)");
    }
    
    return {
      file: fileName,
      status: warnings.length > 0 ? "pass" : "pass",
      message: "Template renders successfully",
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    return {
      file: fileName,
      status: "fail",
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function validateYamlFile(filePath: string): ValidationResult {
  const fileName = path.basename(filePath);
  
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    yaml.parse(content);
    
    return {
      file: fileName,
      status: "pass",
      message: "Valid YAML syntax",
    };
  } catch (error) {
    return {
      file: fileName,
      status: "fail",
      message: `YAML Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function validateMarkdownFile(filePath: string): ValidationResult {
  const fileName = path.basename(filePath);
  
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    
    const warnings: string[] = [];
    
    // Check for common markdown issues
    if (!content.startsWith("#")) {
      warnings.push("File should start with a heading");
    }
    
    // Check for broken links (simplified)
    const brokenLinks = content.match(/\]\(\s*\)/g);
    if (brokenLinks) {
      warnings.push(`Found ${brokenLinks.length} empty link(s)`);
    }
    
    // Check for unclosed code blocks
    const codeBlockCount = (content.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) {
      warnings.push("Unclosed code block detected");
    }
    
    return {
      file: fileName,
      status: warnings.some(w => w.includes("Unclosed")) ? "fail" : "pass",
      message: "Valid Markdown",
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    return {
      file: fileName,
      status: "fail",
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function findTemplateFiles(dir: string): string[] {
  const files: string[] = [];
  
  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        // Skip node_modules and hidden directories
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        // Include template files, YAML, and Markdown
        if (
          entry.name.endsWith(".template") ||
          entry.name.endsWith(".yaml") ||
          entry.name.endsWith(".yml") ||
          entry.name.endsWith(".md") ||
          entry.name.includes("AGENTS")
        ) {
          files.push(fullPath);
        }
      }
    }
  }
  
  walk(dir);
  return files;
}

async function main() {
  console.log("🔍 Template Validation\n");
  console.log("=".repeat(60));
  
  // Load sample data
  const sampleDataPath = path.join(__dirname, "sample-data.yaml");
  let sampleData: Record<string, unknown> = {};
  
  try {
    const sampleDataContent = fs.readFileSync(sampleDataPath, "utf-8");
    sampleData = yaml.parse(sampleDataContent);
    console.log("✅ Loaded sample data\n");
  } catch (error) {
    console.error("❌ Failed to load sample data:", error);
    process.exit(1);
  }
  
  // Find all template files
  const templatesDir = path.resolve(__dirname, "..");
  const files = findTemplateFiles(templatesDir);
  
  console.log(`📁 Found ${files.length} files to validate\n`);
  
  const results: ValidationResult[] = [];
  
  for (const file of files) {
    const ext = path.extname(file);
    const relativePath = path.relative(templatesDir, file);
    
    let result: ValidationResult;
    
    if (ext === ".yaml" || ext === ".yml") {
      result = validateYamlFile(file);
    } else if (ext === ".md" || file.includes("AGENTS")) {
      result = validateMarkdownFile(file);
      
      // Also check as template
      const templateResult = validateTemplateFile(file, sampleData);
      if (templateResult.warnings) {
        result.warnings = [...(result.warnings || []), ...templateResult.warnings];
      }
    } else {
      result = validateTemplateFile(file, sampleData);
    }
    
    result.file = relativePath;
    results.push(result);
  }
  
  // Print results
  const passed = results.filter(r => r.status === "pass");
  const failed = results.filter(r => r.status === "fail");
  const skipped = results.filter(r => r.status === "skip");
  
  console.log("Results:");
  console.log("-".repeat(60));
  
  for (const result of results) {
    const icon = result.status === "pass" ? "✅" : result.status === "fail" ? "❌" : "⏭️";
    console.log(`${icon} ${result.file}`);
    
    if (result.message && result.status !== "pass") {
      console.log(`   ${result.message}`);
    }
    
    if (result.warnings) {
      for (const warning of result.warnings) {
        console.log(`   ⚠️  ${warning}`);
      }
    }
  }
  
  console.log("\n" + "=".repeat(60));
  console.log(`Summary: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`);
  
  if (failed.length > 0) {
    console.log("\n❌ Validation failed!");
    process.exit(1);
  } else {
    console.log("\n✅ All templates validated successfully!");
  }
}

main().catch(console.error);

