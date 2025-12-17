/**
 * Configuration Generator
 * 
 * Generates opencode.json, project-context.yaml, and other configuration files
 * based on detected/selected project settings.
 */

import * as fs from "fs";
import * as path from "path";
import type { TechStack, ProjectInfo } from "./tech-detection";

// =============================================================================
// TYPES
// =============================================================================

export interface ProjectType {
  id: string;
  name: string;
  description: string;
}

export const PROJECT_TYPES: ProjectType[] = [
  { id: "web-app", name: "Web Application", description: "Frontend + Backend" },
  { id: "api", name: "API Service", description: "Backend only" },
  { id: "cli", name: "CLI Tool", description: "Command-line interface" },
  { id: "library", name: "Library/Package", description: "Reusable module" },
  { id: "monorepo", name: "Monorepo", description: "Multiple packages" },
  { id: "mobile", name: "Mobile Application", description: "iOS/Android app" },
  { id: "desktop", name: "Desktop Application", description: "Native desktop app" },
  { id: "other", name: "Other", description: "Custom project type" },
];

export interface ArchitecturePattern {
  id: string;
  name: string;
  description: string;
  layers: ArchitectureLayer[];
  recommendedFor: string[];
}

export interface ArchitectureLayer {
  name: string;
  path: string;
  description: string;
  agentsMd: string;
}

export const ARCHITECTURE_PATTERNS: ArchitecturePattern[] = [
  {
    id: "layered",
    name: "Layered (Repository-Service-Controller)",
    description: "Traditional separation of concerns",
    recommendedFor: ["web-app", "api"],
    layers: [
      { name: "controllers", path: "src/controllers", description: "HTTP handlers and request/response logic", agentsMd: "controllers-AGENTS.md" },
      { name: "services", path: "src/services", description: "Business logic and application rules", agentsMd: "services-AGENTS.md" },
      { name: "repositories", path: "src/repositories", description: "Data access and database operations", agentsMd: "repositories-AGENTS.md" },
      { name: "models", path: "src/models", description: "Data models and type definitions", agentsMd: "models-AGENTS.md" },
    ],
  },
  {
    id: "hexagonal",
    name: "Hexagonal (Ports & Adapters)",
    description: "Maximum testability, dependency inversion",
    recommendedFor: ["api", "library", "microservices"],
    layers: [
      { name: "domain", path: "src/domain", description: "Core business logic", agentsMd: "domain-AGENTS.md" },
      { name: "ports", path: "src/ports", description: "Interface definitions", agentsMd: "ports-AGENTS.md" },
      { name: "adapters", path: "src/adapters", description: "External integrations", agentsMd: "adapters-AGENTS.md" },
      { name: "application", path: "src/application", description: "Application services", agentsMd: "application-AGENTS.md" },
    ],
  },
  {
    id: "clean",
    name: "Clean Architecture",
    description: "Enterprise patterns, strict dependency rules",
    recommendedFor: ["web-app", "api", "enterprise"],
    layers: [
      { name: "entities", path: "src/entities", description: "Enterprise business rules", agentsMd: "entities-AGENTS.md" },
      { name: "use-cases", path: "src/use-cases", description: "Application business rules", agentsMd: "use-cases-AGENTS.md" },
      { name: "interfaces", path: "src/interfaces", description: "Interface adapters", agentsMd: "interfaces-AGENTS.md" },
      { name: "frameworks", path: "src/frameworks", description: "Frameworks and drivers", agentsMd: "frameworks-AGENTS.md" },
    ],
  },
  {
    id: "feature-based",
    name: "Feature-Based (Vertical Slices)",
    description: "Co-located by feature",
    recommendedFor: ["web-app", "monorepo", "large-teams"],
    layers: [
      { name: "features", path: "src/features", description: "Feature modules", agentsMd: "feature-AGENTS.md" },
      { name: "shared", path: "src/shared", description: "Shared utilities", agentsMd: "shared-AGENTS.md" },
      { name: "infrastructure", path: "src/infrastructure", description: "Infrastructure concerns", agentsMd: "infrastructure-AGENTS.md" },
    ],
  },
];

export interface LinearConfig {
  enabled: boolean;
  teamId?: string;
  teamName?: string;
  projectId?: string;
  projectName?: string;
}

export interface MintlifyConfig {
  enabled: boolean;
  docsPath: string;
}

export interface InitProjectConfig {
  projectInfo: ProjectInfo;
  projectType: string;
  techStack: TechStack;
  architecture: ArchitecturePattern;
  linear: LinearConfig;
  mintlify: MintlifyConfig;
  isExisting: boolean;
}

// =============================================================================
// SUGGESTION MAPPING
// =============================================================================

export function suggestArchitecture(projectType: string): ArchitecturePattern {
  const suggestions: Record<string, string> = {
    "web-app": "layered",
    "api": "layered",
    "cli": "layered",
    "library": "hexagonal",
    "monorepo": "feature-based",
    "mobile": "layered",
    "desktop": "layered",
    "enterprise": "clean",
    "other": "layered",
  };

  const suggestedId = suggestions[projectType] || "layered";
  return ARCHITECTURE_PATTERNS.find((p) => p.id === suggestedId) || ARCHITECTURE_PATTERNS[0];
}

export function getSuggestionReason(projectType: string, pattern: ArchitecturePattern): string {
  const reasons: Record<string, Record<string, string>> = {
    "web-app": {
      "layered": "Clear separation of concerns, easy to understand for web apps",
      "feature-based": "Better for large teams working on different features",
    },
    "api": {
      "layered": "Standard REST patterns fit well with layers",
      "hexagonal": "Better if you have many external integrations",
    },
    "library": {
      "hexagonal": "Isolates your library from consumers, maximum flexibility",
      "clean": "Enterprise-grade isolation for complex libraries",
    },
    "monorepo": {
      "feature-based": "Each package is self-contained, promotes code ownership",
    },
    "cli": {
      "layered": "Simple structure works well for command-line tools",
    },
  };

  return reasons[projectType]?.[pattern.id] || 
    `${pattern.name} is well-suited for ${projectType} projects`;
}

// =============================================================================
// CONFIG FILE GENERATION
// =============================================================================

export function generateOpencodeJson(config: InitProjectConfig): string {
  const { techStack, linear } = config;

  // Determine test and lint commands based on tech stack
  let testCommand = "npm test";
  let lintCommand = "npm run lint";

  if (techStack.packageManager === "pnpm") {
    testCommand = "pnpm test";
    lintCommand = "pnpm lint";
  } else if (techStack.packageManager === "yarn") {
    testCommand = "yarn test";
    lintCommand = "yarn lint";
  } else if (techStack.packageManager === "bun") {
    testCommand = "bun test";
    lintCommand = "bun lint";
  } else if (techStack.languages.some((l) => l.name === "Python")) {
    testCommand = "pytest";
    lintCommand = "ruff check .";
  } else if (techStack.languages.some((l) => l.name === "Go")) {
    testCommand = "go test ./...";
    lintCommand = "golangci-lint run";
  } else if (techStack.languages.some((l) => l.name === "Rust")) {
    testCommand = "cargo test";
    lintCommand = "cargo clippy";
  }

  // Build LSP configuration based on languages
  const lsp: Record<string, unknown> = {};
  for (const lang of techStack.languages) {
    const langKey = lang.name.toLowerCase();
    if (["typescript", "javascript"].includes(langKey)) {
      lsp["typescript"] = {
        command: ["typescript-language-server", "--stdio"],
        filetypes: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
        root_markers: ["tsconfig.json", "package.json"],
      };
    } else if (langKey === "python") {
      lsp["python"] = {
        command: ["pyright-langserver", "--stdio"],
        filetypes: ["python"],
        root_markers: ["pyproject.toml", "setup.py", "requirements.txt"],
      };
    } else if (langKey === "go") {
      lsp["go"] = {
        command: ["gopls"],
        filetypes: ["go", "gomod"],
        root_markers: ["go.mod", "go.work"],
      };
    } else if (langKey === "rust") {
      lsp["rust"] = {
        command: ["rust-analyzer"],
        filetypes: ["rust"],
        root_markers: ["Cargo.toml"],
      };
    }
  }

  const opencodeConfig = {
    $schema: "https://opencode.ai/config.json",
    model: "opencode/gemini-3-flash",
    small_model: "anthropic/claude-haiku-3",
    permission: {
      edit: "allow",
      bash: {
        "*": "ask",
        "git status": "allow",
        "git diff": "allow",
        "git log": "allow",
        "git branch": "allow",
        [testCommand]: "allow",
        [lintCommand]: "allow",
      },
      webfetch: "ask",
    },
    share: "manual",
    tools: {},
    mcp: {
      linear: {
        type: "local",
        command: ["npx", "-y", "@linear/mcp-server"],
        enabled: linear.enabled,
        environment: {
          LINEAR_API_KEY: "{env:LINEAR_API_KEY}",
        },
        timeout: 10000,
      },
    },
    lsp: Object.keys(lsp).length > 0 ? lsp : {},
    instructions: [
      ".opencode/instructions/governance.md",
      ".opencode/instructions/linear-workflow.md",
      ".opencode/instructions/documentation-standards.md",
    ],
  };

  return JSON.stringify(opencodeConfig, null, 2);
}

export function generateProjectContextYaml(config: InitProjectConfig): string {
  const { projectInfo, projectType, techStack, architecture, linear, mintlify } = config;
  const now = new Date().toISOString();

  // Build languages array
  const languagesYaml = techStack.languages.map((lang) => {
    let entry = `    - name: "${lang.name}"`;
    if (lang.version) entry += `\n      version: "${lang.version}"`;
    entry += `\n      primary: ${lang.primary}`;
    return entry;
  }).join("\n");

  // Build frameworks section
  let frameworksYaml = "";
  if (techStack.frameworks.frontend) {
    frameworksYaml += `    frontend:\n      name: "${techStack.frameworks.frontend.name}"`;
    if (techStack.frameworks.frontend.version) {
      frameworksYaml += `\n      version: "${techStack.frameworks.frontend.version}"`;
    }
    frameworksYaml += "\n";
  } else {
    frameworksYaml += "    frontend: null\n";
  }

  if (techStack.frameworks.backend) {
    frameworksYaml += `    backend:\n      name: "${techStack.frameworks.backend.name}"`;
    if (techStack.frameworks.backend.version) {
      frameworksYaml += `\n      version: "${techStack.frameworks.backend.version}"`;
    }
    frameworksYaml += "\n";
  } else {
    frameworksYaml += "    backend: null\n";
  }

  // Testing frameworks
  if (techStack.frameworks.testing.length > 0) {
    frameworksYaml += "    testing:\n";
    for (const test of techStack.frameworks.testing) {
      frameworksYaml += `      - name: "${test.name}"\n        type: "unit"`;
      if (test.version) frameworksYaml += `\n        version: "${test.version}"`;
      frameworksYaml += "\n";
    }
  } else {
    frameworksYaml += "    testing: []\n";
  }

  // Databases
  let databasesYaml = "";
  if (techStack.databases.length > 0) {
    for (const db of techStack.databases) {
      databasesYaml += `    - type: "${db.type}"`;
      if (db.name) databasesYaml += `\n      name: "${db.name}"`;
      if (db.orm) databasesYaml += `\n      orm: "${db.orm}"`;
      databasesYaml += "\n";
    }
  }

  // Architecture layers
  const layersYaml = architecture.layers.map((layer) => 
    `    - name: "${layer.name}"\n      path: "${layer.path}"\n      description: "${layer.description}"\n      agents_md: true`
  ).join("\n");

  // Determine formatter based on tech stack
  let formatter = "prettier";
  if (techStack.languages.some((l) => l.name === "Python")) {
    formatter = "ruff";
  } else if (techStack.languages.some((l) => l.name === "Go")) {
    formatter = "gofmt";
  } else if (techStack.languages.some((l) => l.name === "Rust")) {
    formatter = "rustfmt";
  }

  return `# Generated by init-project on ${now}
# OpenCode Project Context

project:
  name: "${projectInfo.name}"
  description: "${projectInfo.description || ""}"
  type: "${projectType}"
  version: "${projectInfo.version || "0.1.0"}"

tech_stack:
  languages:
${languagesYaml}

  frameworks:
${frameworksYaml}
  databases:
${databasesYaml || "    []"}

  package_manager: "${techStack.packageManager || "npm"}"

architecture:
  pattern: "${architecture.id}"
  layers:
${layersYaml}

integrations:
  linear:
    enabled: ${linear.enabled}
${linear.teamId ? `    team_id: "${linear.teamId}"` : "    # team_id: \"TEAM-ID\""}
${linear.projectId ? `    project_id: "${linear.projectId}"` : "    # project_id: \"PROJECT-ID\""}
    workflow:
      require_issue: true
      auto_transition: false

  mintlify:
    enabled: ${mintlify.enabled}
    docs_path: "${mintlify.docsPath}"
    config_file: "mint.json"

  github:
    # repo: "owner/repo"
    default_branch: "main"
    pr_template: true
    issue_templates: true
    actions: true

  ci_cd:
    provider: "github-actions"
    config_path: ".github/workflows/"

conventions:
  naming:
    files: "kebab-case"
    functions: "camelCase"
    classes: "PascalCase"
    constants: "SCREAMING_SNAKE_CASE"
    components: "PascalCase"

  code_style:
    indent: 2
    indent_style: "spaces"
    quotes: "double"
    semicolons: true
    trailing_commas: true
    max_line_length: 100
    formatter: "${formatter}"

  commit_format: "conventional"
  commit_scopes:
    - "feat"
    - "fix"
    - "docs"
    - "style"
    - "refactor"
    - "test"
    - "chore"
  branch_naming: "{type}/{issue-id}-{description}"

metadata:
  created_at: "${now}"
  updated_at: "${now}"
  opencode_version: "1.0.0"
  schema_version: "1.0.0"
`;
}

export function generateMintJson(config: InitProjectConfig): string {
  const { projectInfo } = config;

  return JSON.stringify({
    "$schema": "https://mintlify.com/schema.json",
    "name": projectInfo.name,
    "logo": {
      "dark": "/logo/dark.svg",
      "light": "/logo/light.svg",
    },
    "favicon": "/favicon.svg",
    "colors": {
      "primary": "#0D9373",
      "light": "#07C983",
      "dark": "#0D9373",
    },
    "topbarLinks": [],
    "topbarCtaButton": {
      "name": "GitHub",
      "url": "#",
    },
    "tabs": [
      {
        "name": "API Reference",
        "url": "api-reference",
      },
    ],
    "navigation": [
      {
        "group": "Getting Started",
        "pages": ["introduction"],
      },
      {
        "group": "Architecture",
        "pages": ["architecture/overview"],
      },
      {
        "group": "Guides",
        "pages": [],
      },
    ],
    "footerSocials": {},
  }, null, 2);
}

export function generateIntroductionMdx(config: InitProjectConfig): string {
  const { projectInfo, projectType, architecture } = config;

  return `---
title: Introduction
description: Welcome to ${projectInfo.name} documentation
---

# Welcome to ${projectInfo.name}

${projectInfo.description || "Project documentation"}

## Overview

This is a **${projectType}** project using **${architecture.name}** architecture.

## Quick Links

<CardGroup cols={2}>
  <Card title="Architecture" icon="building" href="/architecture/overview">
    Learn about the project architecture
  </Card>
  <Card title="API Reference" icon="code" href="/api-reference">
    Explore the API endpoints
  </Card>
  <Card title="Guides" icon="book" href="/guides">
    Step-by-step tutorials
  </Card>
  <Card title="Contributing" icon="git-branch" href="/contributing">
    How to contribute
  </Card>
</CardGroup>

## Getting Started

\`\`\`bash
# Clone the repository
git clone <repository-url>

# Install dependencies
npm install  # or pnpm install / yarn

# Start development
npm run dev
\`\`\`

## Project Structure

\`\`\`
${architecture.layers.map((l) => `${l.path}/  # ${l.description}`).join("\n")}
\`\`\`
`;
}

export function generateArchitectureOverviewMdx(config: InitProjectConfig): string {
  const { projectInfo, architecture } = config;

  return `---
title: Architecture Overview
description: ${projectInfo.name} architecture documentation
---

# Architecture Overview

This project follows the **${architecture.name}** pattern.

## Layers

${architecture.layers.map((layer) => `
### ${layer.name.charAt(0).toUpperCase() + layer.name.slice(1)}

**Path:** \`${layer.path}/\`

${layer.description}

See \`${layer.path}/AGENTS.md\` for detailed guidelines.
`).join("\n")}

## Dependency Rules

The architecture enforces specific dependency rules to maintain clean boundaries:

- Inner layers should not depend on outer layers
- Dependencies should flow in one direction
- Use dependency injection for cross-layer communication

## Making Changes

When making architectural changes:

1. Consult the relevant \`AGENTS.md\` file
2. Follow the patterns established in existing code
3. Update documentation if patterns change
4. Get review from \`@strategic-architect\`
`;
}

// =============================================================================
// FILE WRITING
// =============================================================================

export async function writeConfigFiles(
  projectPath: string,
  config: InitProjectConfig,
): Promise<string[]> {
  const createdFiles: string[] = [];

  // Create directories
  const dirs = [
    ".opencode",
    ".opencode/tool",
    ".opencode/instructions",
  ];

  if (config.mintlify.enabled) {
    dirs.push(config.mintlify.docsPath);
    dirs.push(`${config.mintlify.docsPath}/architecture`);
    dirs.push(`${config.mintlify.docsPath}/api-reference`);
    dirs.push(`${config.mintlify.docsPath}/guides`);
  }

  for (const dir of dirs) {
    const fullPath = path.join(projectPath, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  // Write opencode.json
  const opencodeJsonPath = path.join(projectPath, ".opencode/opencode.json");
  fs.writeFileSync(opencodeJsonPath, generateOpencodeJson(config));
  createdFiles.push(".opencode/opencode.json");

  // Write project-context.yaml
  const projectContextPath = path.join(projectPath, ".opencode/project-context.yaml");
  fs.writeFileSync(projectContextPath, generateProjectContextYaml(config));
  createdFiles.push(".opencode/project-context.yaml");

  // Write Mintlify files if enabled
  if (config.mintlify.enabled) {
    const mintJsonPath = path.join(projectPath, config.mintlify.docsPath, "mint.json");
    fs.writeFileSync(mintJsonPath, generateMintJson(config));
    createdFiles.push(`${config.mintlify.docsPath}/mint.json`);

    const introPath = path.join(projectPath, config.mintlify.docsPath, "introduction.mdx");
    fs.writeFileSync(introPath, generateIntroductionMdx(config));
    createdFiles.push(`${config.mintlify.docsPath}/introduction.mdx`);

    const archOverviewPath = path.join(projectPath, config.mintlify.docsPath, "architecture/overview.mdx");
    fs.writeFileSync(archOverviewPath, generateArchitectureOverviewMdx(config));
    createdFiles.push(`${config.mintlify.docsPath}/architecture/overview.mdx`);
  }

  // Update .gitignore
  const gitignorePath = path.join(projectPath, ".gitignore");
  const gitignoreAdditions = `
# OpenCode local configuration
.opencode/local.json
.opencode/*.local.*
`;
  
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, "utf-8");
    if (!existing.includes(".opencode/local.json")) {
      fs.appendFileSync(gitignorePath, gitignoreAdditions);
    }
  } else {
    fs.writeFileSync(gitignorePath, gitignoreAdditions.trim());
    createdFiles.push(".gitignore");
  }

  return createdFiles;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  PROJECT_TYPES,
  ARCHITECTURE_PATTERNS,
};

