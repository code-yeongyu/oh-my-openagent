/**
 * Init-Project Runner
 * 
 * Main orchestrator for the init-project command.
 * Coordinates detection, prompts, and file generation.
 */

import * as fs from "fs";
import * as path from "path";
import {
  detectTechStack,
  formatDetectionResults,
  type TechStack,
  type ProjectInfo,
} from "./tech-detection";
import {
  writeConfigFiles,
  suggestArchitecture,
  getSuggestionReason,
  PROJECT_TYPES,
  ARCHITECTURE_PATTERNS,
  type InitProjectConfig,
  type ArchitecturePattern,
  type LinearConfig,
  type MintlifyConfig,
} from "./config-generator";
import { generateAgentsMdFiles } from "./agents-generator";

// =============================================================================
// TYPES
// =============================================================================

export interface InitProjectOptions {
  /** Project root path */
  projectPath: string;
  /** Skip prompts and use detected/default values */
  nonInteractive?: boolean;
  /** Pre-configured values (for testing or automation) */
  preset?: Partial<InitProjectConfig>;
}

export interface InitProjectResult {
  success: boolean;
  config: InitProjectConfig;
  createdFiles: string[];
  errors: string[];
  warnings: string[];
}

// =============================================================================
// CHECK FOR EXISTING CONFIG
// =============================================================================

export function checkExistingConfig(projectPath: string): {
  exists: boolean;
  files: string[];
} {
  const opencodeDir = path.join(projectPath, ".opencode");
  const agentsMd = path.join(projectPath, "AGENTS.md");

  const existingFiles: string[] = [];

  if (fs.existsSync(opencodeDir)) {
    existingFiles.push(".opencode/");
    
    // Check specific files
    const configFiles = [
      "opencode.json",
      "project-context.yaml",
    ];
    
    for (const file of configFiles) {
      const filePath = path.join(opencodeDir, file);
      if (fs.existsSync(filePath)) {
        existingFiles.push(`.opencode/${file}`);
      }
    }
  }

  if (fs.existsSync(agentsMd)) {
    existingFiles.push("AGENTS.md");
  }

  return {
    exists: existingFiles.length > 0,
    files: existingFiles,
  };
}

// =============================================================================
// CHECK LINEAR API KEY
// =============================================================================

export function checkLinearApiKey(): {
  found: boolean;
  envVar: string;
} {
  const apiKey = process.env.LINEAR_API_KEY;
  return {
    found: !!apiKey && apiKey.startsWith("lin_api_"),
    envVar: "LINEAR_API_KEY",
  };
}

// =============================================================================
// SUMMARY GENERATION
// =============================================================================

export function generateSummary(result: InitProjectResult): string {
  const { config, createdFiles } = result;
  const { projectInfo, techStack, architecture, linear, mintlify } = config;

  const languagesList = techStack.languages
    .map((l) => `${l.name}${l.version ? ` ${l.version}` : ""}`)
    .join(", ");

  let output = `
🎉 **Project Initialized Successfully!**

═══════════════════════════════════════════════════════════════════════════

## Configuration Summary

**Project**: ${projectInfo.name}
**Type**: ${config.projectType}
**Architecture**: ${architecture.name}

**Technology Stack:**
┌─────────────────────────────────────────────────────────────────────────┐
│ Languages    │ ${languagesList.padEnd(55)}│
│ Frontend     │ ${(techStack.frameworks.frontend?.name || "None").padEnd(55)}│
│ Backend      │ ${(techStack.frameworks.backend?.name || "None").padEnd(55)}│
│ Database     │ ${(techStack.databases[0]?.type || "None").padEnd(55)}│
│ Package Mgr  │ ${(techStack.packageManager || "Not detected").padEnd(55)}│
└─────────────────────────────────────────────────────────────────────────┘

**Integrations:**
┌─────────────────────────────────────────────────────────────────────────┐
│ Linear       │ ${(linear.enabled ? (linear.teamName || "Configured") : "Disabled").padEnd(55)}│
│ Mintlify     │ ${(mintlify.enabled ? mintlify.docsPath : "Disabled").padEnd(55)}│
└─────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════

## Files Created

**Configuration:**
${createdFiles.filter((f) => f.includes(".opencode/")).map((f) => `- \`${f}\``).join("\n")}

**Instructions:**
${createdFiles.filter((f) => f.endsWith("AGENTS.md")).map((f) => `- \`${f}\``).join("\n")}
${mintlify.enabled ? `
**Documentation:**
${createdFiles.filter((f) => f.includes(mintlify.docsPath)).map((f) => `- \`${f}\``).join("\n")}
` : ""}
═══════════════════════════════════════════════════════════════════════════

## Available Agents

| Agent | Purpose | Invoke With |
|-------|---------|-------------|
| orchestrator | Route requests to optimal agents | @orchestrator |
| product-strategist | Requirements, user stories, PRDs | @product-strategist |
| strategic-architect | System design, ADRs | @strategic-architect |
| linear-coordinator | Linear tickets, branches | @linear-coordinator |
| implementation-specialist | Production code | @implementation-specialist |
| quick-fixer | Bug fixes, hotfixes | @quick-fixer |
| code-reviewer | Code reviews, audits | @code-reviewer |
| test-engineer | Tests, coverage | @test-engineer |
| documentation-master | Docs, API specs | @documentation-master |
| project-guru | Codebase explanations | @project-guru |

═══════════════════════════════════════════════════════════════════════════

## Next Steps

### 1. Review Generated Files
\`\`\`bash
# Check configuration
cat .opencode/opencode.json
cat .opencode/project-context.yaml

# Review AGENTS.md files
cat AGENTS.md
${architecture.layers.map((l) => `cat ${l.path}/AGENTS.md`).join("\n")}
\`\`\`

### 2. Start Your First Task

**Plan a feature:**
\`\`\`
@orchestrator Plan the first feature for this project
\`\`\`

**Ask about the project:**
\`\`\`
@project-guru Explain the project architecture
\`\`\`

**Create a Linear issue:**
\`\`\`
@linear-coordinator Create issue "Set up CI/CD pipeline"
\`\`\`

### 3. Quick Reference

| Command | Description |
|---------|-------------|
| \`/init-project\` | Re-run initialization |
| \`@orchestrator help\` | Show available workflows |
| \`@orchestrator {request}\` | Route any request |

═══════════════════════════════════════════════════════════════════════════

**Happy coding!** 🚀

Need help? Ask \`@project-guru\` to explain anything about your setup.
`;

  return output;
}

// =============================================================================
// MAIN RUNNER
// =============================================================================

export async function runInitProject(
  options: InitProjectOptions,
): Promise<InitProjectResult> {
  const { projectPath, preset } = options;
  const errors: string[] = [];
  const warnings: string[] = [];
  const createdFiles: string[] = [];

  // Step 1: Check for existing configuration
  const existing = checkExistingConfig(projectPath);
  if (existing.exists && !preset?.isExisting) {
    warnings.push(`Existing configuration found: ${existing.files.join(", ")}`);
  }

  // Step 2: Detect or use preset tech stack
  let techStack: TechStack;
  let projectInfo: ProjectInfo;
  let isMonorepo = false;

  if (preset?.techStack && preset?.projectInfo) {
    techStack = preset.techStack;
    projectInfo = preset.projectInfo;
  } else {
    const detected = await detectTechStack(projectPath);
    techStack = detected.techStack;
    projectInfo = detected.projectInfo;
    isMonorepo = detected.isMonorepo;

    if (detected.isMonorepo) {
      warnings.push(`Monorepo detected (${detected.monorepoType}). Consider per-package configuration.`);
    }
  }

  // Step 3: Determine project type
  let projectType = preset?.projectType || "api";
  if (!preset?.projectType) {
    // Infer from detected stack
    if (isMonorepo) {
      projectType = "monorepo";
    } else if (techStack.frameworks.frontend && techStack.frameworks.backend) {
      projectType = "web-app";
    } else if (techStack.frameworks.backend) {
      projectType = "api";
    } else if (techStack.frameworks.frontend) {
      projectType = "web-app";
    }
  }

  // Step 4: Select architecture
  let architecture: ArchitecturePattern;
  if (preset?.architecture) {
    architecture = preset.architecture;
  } else {
    architecture = suggestArchitecture(projectType);
  }

  // Step 5: Configure Linear
  let linear: LinearConfig = {
    enabled: false,
  };
  if (preset?.linear) {
    linear = preset.linear;
  } else {
    const linearCheck = checkLinearApiKey();
    linear.enabled = linearCheck.found;
    if (!linearCheck.found) {
      warnings.push("LINEAR_API_KEY not found. Linear integration disabled.");
    }
  }

  // Step 6: Configure Mintlify
  let mintlify: MintlifyConfig = {
    enabled: preset?.mintlify?.enabled ?? false,
    docsPath: preset?.mintlify?.docsPath || "docs/",
  };

  // Step 7: Build final config
  const config: InitProjectConfig = {
    projectInfo: {
      name: preset?.projectInfo?.name || projectInfo.name || path.basename(projectPath),
      description: preset?.projectInfo?.description || projectInfo.description || "",
      version: preset?.projectInfo?.version || projectInfo.version || "0.1.0",
    },
    projectType,
    techStack,
    architecture,
    linear,
    mintlify,
    isExisting: existing.exists,
  };

  // Step 8: Write configuration files
  try {
    const configFiles = await writeConfigFiles(projectPath, config);
    createdFiles.push(...configFiles);
  } catch (error) {
    errors.push(`Failed to write config files: ${error}`);
  }

  // Step 9: Generate AGENTS.md files
  try {
    const agentsFiles = await generateAgentsMdFiles(projectPath, config);
    createdFiles.push(...agentsFiles);
  } catch (error) {
    errors.push(`Failed to generate AGENTS.md files: ${error}`);
  }

  return {
    success: errors.length === 0,
    config,
    createdFiles,
    errors,
    warnings,
  };
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

if (require.main === module) {
  const projectPath = process.argv[2] || process.cwd();
  
  console.log("🚀 **OpenCode Project Initialization**\n");
  console.log(`Initializing project at: ${projectPath}\n`);

  runInitProject({ projectPath })
    .then((result) => {
      if (result.warnings.length > 0) {
        console.log("⚠️  Warnings:");
        result.warnings.forEach((w) => console.log(`   - ${w}`));
        console.log("");
      }

      if (result.errors.length > 0) {
        console.log("❌ Errors:");
        result.errors.forEach((e) => console.log(`   - ${e}`));
        process.exit(1);
      }

      console.log(generateSummary(result));
    })
    .catch((error) => {
      console.error("Error during initialization:", error);
      process.exit(1);
    });
}

