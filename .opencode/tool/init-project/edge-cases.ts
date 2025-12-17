/**
 * Edge Case Handlers
 * 
 * Handles special cases during project initialization:
 * - Existing .opencode/ directory
 * - Missing LINEAR_API_KEY
 * - Custom architecture patterns
 * - Monorepo structures
 * - Network unavailable
 */

import * as fs from "fs";
import * as path from "path";
import type { ArchitecturePattern, ArchitectureLayer } from "./config-generator";

// =============================================================================
// EXISTING CONFIG HANDLING
// =============================================================================

export interface ExistingConfigCheck {
  exists: boolean;
  files: string[];
  canMerge: boolean;
  mergePossibleFiles: string[];
  mustOverwriteFiles: string[];
}

export function checkExistingConfiguration(projectPath: string): ExistingConfigCheck {
  const opencodeDir = path.join(projectPath, ".opencode");
  const result: ExistingConfigCheck = {
    exists: false,
    files: [],
    canMerge: true,
    mergePossibleFiles: [],
    mustOverwriteFiles: [],
  };

  if (!fs.existsSync(opencodeDir)) {
    return result;
  }

  result.exists = true;

  // Check specific config files
  const configFiles = [
    { path: "opencode.json", canMerge: true },
    { path: "project-context.yaml", canMerge: true },
  ];

  for (const file of configFiles) {
    const fullPath = path.join(opencodeDir, file.path);
    if (fs.existsSync(fullPath)) {
      result.files.push(`.opencode/${file.path}`);
      if (file.canMerge) {
        result.mergePossibleFiles.push(file.path);
      } else {
        result.mustOverwriteFiles.push(file.path);
        result.canMerge = false;
      }
    }
  }

  // Check root AGENTS.md
  const agentsMdPath = path.join(projectPath, "AGENTS.md");
  if (fs.existsSync(agentsMdPath)) {
    result.files.push("AGENTS.md");
    result.mustOverwriteFiles.push("AGENTS.md");
  }

  return result;
}

export type ConflictResolution = "overwrite" | "merge" | "cancel";

export function getConflictResolutionPrompt(check: ExistingConfigCheck): string {
  let prompt = `
⚠️  **Existing Configuration Found**

The following files already exist:
${check.files.map((f) => `  - ${f}`).join("\n")}

`;

  if (check.canMerge) {
    prompt += `
What would you like to do?

1. **Overwrite** - Remove existing config and start fresh
2. **Merge** - Keep existing config and update missing parts only
3. **Cancel** - Exit without changes

> Select [1-3]:
`;
  } else {
    prompt += `
Some files cannot be merged. What would you like to do?

1. **Overwrite** - Remove existing config and start fresh
2. **Cancel** - Exit without changes

> Select [1-2]:
`;
  }

  return prompt;
}

export async function handleExistingConfig(
  projectPath: string,
  resolution: ConflictResolution,
): Promise<{ success: boolean; message: string }> {
  if (resolution === "cancel") {
    return { success: false, message: "Initialization cancelled by user." };
  }

  if (resolution === "overwrite") {
    // Backup existing files
    const backupDir = path.join(projectPath, ".opencode.backup");
    const opencodeDir = path.join(projectPath, ".opencode");
    
    if (fs.existsSync(opencodeDir)) {
      // Create backup
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = `${backupDir}-${timestamp}`;
      
      try {
        fs.renameSync(opencodeDir, backupPath);
        return {
          success: true,
          message: `Existing config backed up to ${backupPath}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to backup existing config: ${error}`,
        };
      }
    }
  }

  // Merge: just continue, files will be updated/created as needed
  return { success: true, message: "Merging with existing configuration." };
}

// =============================================================================
// MISSING LINEAR_API_KEY HANDLING
// =============================================================================

export interface LinearApiKeyCheck {
  found: boolean;
  value?: string;
  envVar: string;
}

export function checkLinearApiKey(): LinearApiKeyCheck {
  const apiKey = process.env.LINEAR_API_KEY;
  
  return {
    found: !!apiKey && apiKey.startsWith("lin_api_"),
    value: apiKey,
    envVar: "LINEAR_API_KEY",
  };
}

export function getLinearSetupInstructions(): string {
  return `
⚠️  **LINEAR_API_KEY not found**

Linear integration requires an API key. Without it, you won't be able to:
- Create and manage Linear issues
- Get automatic branch names
- Track work in Linear

**Setup Instructions:**

1. Go to Linear → Settings → API → Personal API Keys
   https://linear.app/settings/api

2. Click "Create key" and give it a name (e.g., "OpenCode")

3. Copy the key (starts with "lin_api_")

4. Add to your environment:

   **macOS/Linux** (add to ~/.zshrc or ~/.bashrc):
   \`\`\`bash
   export LINEAR_API_KEY="lin_api_your_key_here"
   \`\`\`

   **Windows PowerShell** (add to profile):
   \`\`\`powershell
   $env:LINEAR_API_KEY="lin_api_your_key_here"
   \`\`\`

5. Restart your terminal or run \`source ~/.zshrc\`

**Options:**
1. I've added the key - continue with Linear setup
2. Skip Linear setup (can be configured later)

> Select [1-2]:
`;
}

// =============================================================================
// CUSTOM ARCHITECTURE HANDLING
// =============================================================================

export interface CustomLayerDefinition {
  name: string;
  path: string;
  description: string;
  mayImport: string[];
  mustNotImport: string[];
}

export function getCustomArchitecturePrompt(): string {
  return `
📐 **Custom Architecture Definition**

You've chosen to define a custom architecture pattern.

Let's define your layers. For each layer, you'll provide:
- Name (e.g., "domain", "api", "data")
- Path (e.g., "src/domain")
- Description
- Dependency rules (what it can/cannot import)

**First Layer:**

Layer name:
> 

Layer path (relative to project root):
> 

Layer description:
> 
`;
}

export function getAddLayerPrompt(existingLayers: string[]): string {
  return `
**Add another layer?** [Y/n]

Current layers: ${existingLayers.join(", ")}

Layer name:
> 
`;
}

export function getDependencyRulesPrompt(layerName: string, allLayers: string[]): string {
  const otherLayers = allLayers.filter((l) => l !== layerName);
  
  return `
**Dependency Rules for "${layerName}":**

Which layers can ${layerName} import from?
Available: ${otherLayers.join(", ")} (or "none")
> 

Which layers MUST ${layerName} NOT import from?
Available: ${otherLayers.join(", ")} (or "none")
> 
`;
}

export function createCustomArchitecture(
  name: string,
  description: string,
  layers: CustomLayerDefinition[],
): ArchitecturePattern {
  return {
    id: "custom",
    name: name,
    description: description,
    recommendedFor: ["other"],
    layers: layers.map((layer) => ({
      name: layer.name,
      path: layer.path,
      description: layer.description,
      agentsMd: `${layer.name}-AGENTS.md`,
    })),
  };
}

export function generateCustomLayerAgentsMd(layer: CustomLayerDefinition): string {
  const layerNameCapitalized = layer.name.charAt(0).toUpperCase() + layer.name.slice(1);

  return `# ${layerNameCapitalized} Layer

> Custom architecture layer

## Purpose

${layer.description}

## Rules

### DO ✅

1. Keep ${layer.name} focused on its core responsibility
2. Follow established patterns in existing code
3. Write comprehensive tests
4. Document complex logic

### DON'T ❌

1. Don't mix concerns from other layers
2. Don't bypass the established architecture
3. Don't create circular dependencies

## Dependencies

### MAY Import
${layer.mayImport.length > 0 ? layer.mayImport.map((l) => `- \`../${l}/\``).join("\n") : "- None (this is an isolated layer)"}

### MUST NOT Import
${layer.mustNotImport.length > 0 ? layer.mustNotImport.map((l) => `- \`../${l}/\``).join("\n") : "- (No restrictions beyond MAY Import)"}

## File Structure

\`\`\`
${layer.path}/
├── index.ts     # Public exports
├── types.ts     # Type definitions
└── __tests__/   # Tests
\`\`\`

## Testing

- Write unit tests for all public functions
- Use mocks for external dependencies
- Aim for >80% coverage

## Related

- **Project Overview**: \`/AGENTS.md\`
- **Project Context**: \`.opencode/project-context.yaml\`
`;
}

// =============================================================================
// MONOREPO HANDLING
// =============================================================================

export interface MonorepoInfo {
  isMonorepo: boolean;
  type?: "lerna" | "pnpm" | "turbo" | "nx" | "rush" | "yarn";
  configFile?: string;
  packages: string[];
}

export function detectMonorepo(projectPath: string): MonorepoInfo {
  const result: MonorepoInfo = {
    isMonorepo: false,
    packages: [],
  };

  // Check for monorepo config files
  const monorepoConfigs: Array<{
    file: string;
    type: MonorepoInfo["type"];
    packagesGetter?: (content: string) => string[];
  }> = [
    { file: "lerna.json", type: "lerna" },
    { file: "pnpm-workspace.yaml", type: "pnpm" },
    { file: "turbo.json", type: "turbo" },
    { file: "nx.json", type: "nx" },
    { file: "rush.json", type: "rush" },
  ];

  for (const config of monorepoConfigs) {
    const configPath = path.join(projectPath, config.file);
    if (fs.existsSync(configPath)) {
      result.isMonorepo = true;
      result.type = config.type;
      result.configFile = config.file;

      // Try to detect packages
      try {
        const packagesDir = path.join(projectPath, "packages");
        if (fs.existsSync(packagesDir)) {
          const dirs = fs.readdirSync(packagesDir, { withFileTypes: true });
          result.packages = dirs
            .filter((d) => d.isDirectory())
            .map((d) => `packages/${d.name}`);
        }
      } catch {
        // Ignore package detection errors
      }

      break;
    }
  }

  // Check for yarn workspaces in package.json
  if (!result.isMonorepo) {
    const packageJsonPath = path.join(projectPath, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        if (pkg.workspaces) {
          result.isMonorepo = true;
          result.type = "yarn";
          result.configFile = "package.json";
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  return result;
}

export function getMonorepoConfigPrompt(info: MonorepoInfo): string {
  return `
🗂️  **Monorepo Detected**

Type: ${info.type}
Config: ${info.configFile}
${info.packages.length > 0 ? `Packages: ${info.packages.join(", ")}` : ""}

How would you like to configure OpenCode?

1. **Root only** - Single configuration at repository root
2. **Per-package** - Individual AGENTS.md for each package (${info.packages.length} packages)
3. **Hybrid** - Root config + per-package AGENTS.md files

> Select [1-3]:
`;
}

// =============================================================================
// NETWORK UNAVAILABLE HANDLING
// =============================================================================

export function isNetworkAvailable(): boolean {
  // Simple check - in a real implementation, you'd ping Linear's API
  return process.env.LINEAR_API_KEY !== undefined;
}

export function getOfflineModePrompt(): string {
  return `
🔌 **Network Unavailable**

Some features require network access:
- Linear team/project selection
- Linear issue creation

**Options:**
1. Continue in offline mode (Linear can be configured later)
2. Retry connection
3. Cancel initialization

> Select [1-3]:
`;
}

export function getOfflineModeWarning(): string {
  return `
⚠️  **Offline Mode Active**

The following features are disabled:
- Linear integration (can be configured later with /init-project)
- Remote template fetching

All local features are available.
`;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  checkExistingConfiguration,
  getConflictResolutionPrompt,
  handleExistingConfig,
  getLinearSetupInstructions,
  getCustomArchitecturePrompt,
  getAddLayerPrompt,
  getDependencyRulesPrompt,
  createCustomArchitecture,
  generateCustomLayerAgentsMd,
  detectMonorepo,
  getMonorepoConfigPrompt,
  isNetworkAvailable,
  getOfflineModePrompt,
  getOfflineModeWarning,
};

