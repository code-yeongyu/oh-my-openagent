/**
 * Technology Detection Utilities
 * 
 * Scans a project directory for configuration files and detects
 * the technology stack being used.
 */

import * as fs from "fs";
import * as path from "path";

// =============================================================================
// TYPES
// =============================================================================

export interface DetectedLanguage {
  name: string;
  version?: string;
  primary: boolean;
  detectedFrom: string;
}

export interface DetectedFramework {
  name: string;
  version?: string;
  type: "frontend" | "backend" | "testing" | "orm";
  detectedFrom: string;
}

export interface DetectedDatabase {
  type: string;
  name?: string;
  orm?: string;
  detectedFrom: string;
}

export interface TechStack {
  languages: DetectedLanguage[];
  frameworks: {
    frontend?: DetectedFramework;
    backend?: DetectedFramework;
    testing: DetectedFramework[];
    orm?: DetectedFramework;
  };
  databases: DetectedDatabase[];
  packageManager?: string;
}

export interface ProjectInfo {
  name: string;
  description?: string;
  version?: string;
  detectedFrom?: string;
}

// =============================================================================
// CONFIGURATION FILE DETECTORS
// =============================================================================

interface ConfigDetector {
  file: string;
  detect: (content: string, projectPath: string) => Partial<TechStack> & { projectInfo?: ProjectInfo };
}

const configDetectors: ConfigDetector[] = [
  // package.json - Node.js/JavaScript/TypeScript
  {
    file: "package.json",
    detect: (content) => {
      const pkg = JSON.parse(content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const result: Partial<TechStack> & { projectInfo?: ProjectInfo } = {
        languages: [],
        frameworks: { testing: [] },
        databases: [],
      };

      // Project info
      result.projectInfo = {
        name: pkg.name,
        description: pkg.description,
        version: pkg.version,
        detectedFrom: "package.json",
      };

      // Language detection
      if (deps.typescript || pkg.devDependencies?.typescript) {
        result.languages!.push({
          name: "TypeScript",
          version: deps.typescript || pkg.devDependencies?.typescript,
          primary: true,
          detectedFrom: "package.json",
        });
      } else {
        result.languages!.push({
          name: "JavaScript",
          version: pkg.engines?.node,
          primary: true,
          detectedFrom: "package.json",
        });
      }

      // Frontend frameworks
      if (deps.next) {
        result.frameworks!.frontend = {
          name: "Next.js",
          version: deps.next,
          type: "frontend",
          detectedFrom: "package.json",
        };
      } else if (deps.react || deps["react-dom"]) {
        result.frameworks!.frontend = {
          name: "React",
          version: deps.react || deps["react-dom"],
          type: "frontend",
          detectedFrom: "package.json",
        };
      } else if (deps.vue) {
        result.frameworks!.frontend = {
          name: "Vue",
          version: deps.vue,
          type: "frontend",
          detectedFrom: "package.json",
        };
      } else if (deps.svelte) {
        result.frameworks!.frontend = {
          name: "Svelte",
          version: deps.svelte,
          type: "frontend",
          detectedFrom: "package.json",
        };
      } else if (deps["@angular/core"]) {
        result.frameworks!.frontend = {
          name: "Angular",
          version: deps["@angular/core"],
          type: "frontend",
          detectedFrom: "package.json",
        };
      }

      // Backend frameworks
      if (deps["@nestjs/core"]) {
        result.frameworks!.backend = {
          name: "NestJS",
          version: deps["@nestjs/core"],
          type: "backend",
          detectedFrom: "package.json",
        };
      } else if (deps.fastify) {
        result.frameworks!.backend = {
          name: "Fastify",
          version: deps.fastify,
          type: "backend",
          detectedFrom: "package.json",
        };
      } else if (deps.express) {
        result.frameworks!.backend = {
          name: "Express",
          version: deps.express,
          type: "backend",
          detectedFrom: "package.json",
        };
      } else if (deps.hono) {
        result.frameworks!.backend = {
          name: "Hono",
          version: deps.hono,
          type: "backend",
          detectedFrom: "package.json",
        };
      }

      // Testing frameworks
      if (deps.vitest || pkg.devDependencies?.vitest) {
        result.frameworks!.testing.push({
          name: "Vitest",
          version: deps.vitest || pkg.devDependencies?.vitest,
          type: "testing",
          detectedFrom: "package.json",
        });
      }
      if (deps.jest || pkg.devDependencies?.jest) {
        result.frameworks!.testing.push({
          name: "Jest",
          version: deps.jest || pkg.devDependencies?.jest,
          type: "testing",
          detectedFrom: "package.json",
        });
      }
      if (deps.playwright || deps["@playwright/test"]) {
        result.frameworks!.testing.push({
          name: "Playwright",
          version: deps.playwright || deps["@playwright/test"],
          type: "testing",
          detectedFrom: "package.json",
        });
      }
      if (deps.cypress) {
        result.frameworks!.testing.push({
          name: "Cypress",
          version: deps.cypress,
          type: "testing",
          detectedFrom: "package.json",
        });
      }

      // ORM detection
      if (deps.prisma || deps["@prisma/client"]) {
        result.frameworks!.orm = {
          name: "Prisma",
          version: deps.prisma || deps["@prisma/client"],
          type: "orm",
          detectedFrom: "package.json",
        };
      } else if (deps["drizzle-orm"]) {
        result.frameworks!.orm = {
          name: "Drizzle",
          version: deps["drizzle-orm"],
          type: "orm",
          detectedFrom: "package.json",
        };
      } else if (deps.typeorm) {
        result.frameworks!.orm = {
          name: "TypeORM",
          version: deps.typeorm,
          type: "orm",
          detectedFrom: "package.json",
        };
      }

      return result;
    },
  },

  // tsconfig.json - TypeScript
  {
    file: "tsconfig.json",
    detect: (content) => {
      try {
        const config = JSON.parse(content);
        return {
          languages: [
            {
              name: "TypeScript",
              version: config.compilerOptions?.target,
              primary: true,
              detectedFrom: "tsconfig.json",
            },
          ],
        };
      } catch {
        return { languages: [] };
      }
    },
  },

  // pyproject.toml - Python
  {
    file: "pyproject.toml",
    detect: (content) => {
      const result: Partial<TechStack> & { projectInfo?: ProjectInfo } = {
        languages: [],
        frameworks: { testing: [] },
        databases: [],
      };

      // Simple TOML parsing for key fields
      const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
      const versionMatch = content.match(/version\s*=\s*"([^"]+)"/);
      const descMatch = content.match(/description\s*=\s*"([^"]+)"/);
      const pythonMatch = content.match(/python\s*=\s*"([^"]+)"/);

      if (nameMatch) {
        result.projectInfo = {
          name: nameMatch[1],
          version: versionMatch?.[1],
          description: descMatch?.[1],
          detectedFrom: "pyproject.toml",
        };
      }

      // Python version
      result.languages!.push({
        name: "Python",
        version: pythonMatch?.[1]?.replace(/[^0-9.]/g, ""),
        primary: true,
        detectedFrom: "pyproject.toml",
      });

      // Framework detection
      if (content.includes("fastapi")) {
        result.frameworks!.backend = {
          name: "FastAPI",
          type: "backend",
          detectedFrom: "pyproject.toml",
        };
      } else if (content.includes("django")) {
        result.frameworks!.backend = {
          name: "Django",
          type: "backend",
          detectedFrom: "pyproject.toml",
        };
      } else if (content.includes("flask")) {
        result.frameworks!.backend = {
          name: "Flask",
          type: "backend",
          detectedFrom: "pyproject.toml",
        };
      }

      // Testing
      if (content.includes("pytest")) {
        result.frameworks!.testing.push({
          name: "pytest",
          type: "testing",
          detectedFrom: "pyproject.toml",
        });
      }

      // ORM
      if (content.includes("sqlalchemy")) {
        result.frameworks!.orm = {
          name: "SQLAlchemy",
          type: "orm",
          detectedFrom: "pyproject.toml",
        };
      }

      return result;
    },
  },

  // requirements.txt - Python (fallback)
  {
    file: "requirements.txt",
    detect: (content) => {
      const result: Partial<TechStack> = {
        languages: [
          {
            name: "Python",
            primary: true,
            detectedFrom: "requirements.txt",
          },
        ],
        frameworks: { testing: [] },
      };

      const lines = content.toLowerCase().split("\n");

      // Framework detection
      if (lines.some((l) => l.startsWith("fastapi"))) {
        result.frameworks!.backend = {
          name: "FastAPI",
          type: "backend",
          detectedFrom: "requirements.txt",
        };
      } else if (lines.some((l) => l.startsWith("django"))) {
        result.frameworks!.backend = {
          name: "Django",
          type: "backend",
          detectedFrom: "requirements.txt",
        };
      } else if (lines.some((l) => l.startsWith("flask"))) {
        result.frameworks!.backend = {
          name: "Flask",
          type: "backend",
          detectedFrom: "requirements.txt",
        };
      }

      // Testing
      if (lines.some((l) => l.startsWith("pytest"))) {
        result.frameworks!.testing.push({
          name: "pytest",
          type: "testing",
          detectedFrom: "requirements.txt",
        });
      }

      return result;
    },
  },

  // go.mod - Go
  {
    file: "go.mod",
    detect: (content) => {
      const result: Partial<TechStack> & { projectInfo?: ProjectInfo } = {
        languages: [],
        frameworks: { testing: [] },
      };

      const moduleMatch = content.match(/module\s+(\S+)/);
      const goMatch = content.match(/go\s+(\d+\.\d+)/);

      if (moduleMatch) {
        result.projectInfo = {
          name: moduleMatch[1].split("/").pop() || moduleMatch[1],
          detectedFrom: "go.mod",
        };
      }

      result.languages!.push({
        name: "Go",
        version: goMatch?.[1],
        primary: true,
        detectedFrom: "go.mod",
      });

      // Framework detection
      if (content.includes("github.com/gin-gonic/gin")) {
        result.frameworks!.backend = {
          name: "Gin",
          type: "backend",
          detectedFrom: "go.mod",
        };
      } else if (content.includes("github.com/labstack/echo")) {
        result.frameworks!.backend = {
          name: "Echo",
          type: "backend",
          detectedFrom: "go.mod",
        };
      }

      // ORM
      if (content.includes("gorm.io/gorm")) {
        result.frameworks!.orm = {
          name: "GORM",
          type: "orm",
          detectedFrom: "go.mod",
        };
      }

      return result;
    },
  },

  // Cargo.toml - Rust
  {
    file: "Cargo.toml",
    detect: (content) => {
      const result: Partial<TechStack> & { projectInfo?: ProjectInfo } = {
        languages: [],
        frameworks: { testing: [] },
      };

      const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
      const versionMatch = content.match(/version\s*=\s*"([^"]+)"/);
      const editionMatch = content.match(/edition\s*=\s*"([^"]+)"/);

      if (nameMatch) {
        result.projectInfo = {
          name: nameMatch[1],
          version: versionMatch?.[1],
          detectedFrom: "Cargo.toml",
        };
      }

      result.languages!.push({
        name: "Rust",
        version: editionMatch?.[1],
        primary: true,
        detectedFrom: "Cargo.toml",
      });

      // Web frameworks
      if (content.includes("actix-web")) {
        result.frameworks!.backend = {
          name: "Actix Web",
          type: "backend",
          detectedFrom: "Cargo.toml",
        };
      } else if (content.includes("axum")) {
        result.frameworks!.backend = {
          name: "Axum",
          type: "backend",
          detectedFrom: "Cargo.toml",
        };
      } else if (content.includes("rocket")) {
        result.frameworks!.backend = {
          name: "Rocket",
          type: "backend",
          detectedFrom: "Cargo.toml",
        };
      }

      return result;
    },
  },
];

// =============================================================================
// PACKAGE MANAGER DETECTION
// =============================================================================

const packageManagerFiles: Record<string, string> = {
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "package-lock.json": "npm",
  "bun.lockb": "bun",
  "poetry.lock": "poetry",
  "Pipfile.lock": "pipenv",
  "uv.lock": "uv",
  "Cargo.lock": "cargo",
  "go.sum": "go mod",
};

// =============================================================================
// DATABASE DETECTION
// =============================================================================

interface DatabaseDetector {
  file: string;
  detect: (content: string) => DetectedDatabase | null;
}

const databaseDetectors: DatabaseDetector[] = [
  // Docker Compose
  {
    file: "docker-compose.yml",
    detect: (content) => {
      const lowerContent = content.toLowerCase();
      if (lowerContent.includes("postgres") || lowerContent.includes("postgresql")) {
        return { type: "postgresql", detectedFrom: "docker-compose.yml" };
      }
      if (lowerContent.includes("mysql") || lowerContent.includes("mariadb")) {
        return { type: "mysql", detectedFrom: "docker-compose.yml" };
      }
      if (lowerContent.includes("mongo")) {
        return { type: "mongodb", detectedFrom: "docker-compose.yml" };
      }
      if (lowerContent.includes("redis")) {
        return { type: "redis", name: "cache", detectedFrom: "docker-compose.yml" };
      }
      return null;
    },
  },
  {
    file: "docker-compose.yaml",
    detect: (content) => {
      const lowerContent = content.toLowerCase();
      if (lowerContent.includes("postgres")) {
        return { type: "postgresql", detectedFrom: "docker-compose.yaml" };
      }
      if (lowerContent.includes("mysql")) {
        return { type: "mysql", detectedFrom: "docker-compose.yaml" };
      }
      if (lowerContent.includes("mongo")) {
        return { type: "mongodb", detectedFrom: "docker-compose.yaml" };
      }
      return null;
    },
  },
  // Prisma schema
  {
    file: "prisma/schema.prisma",
    detect: (content) => {
      const providerMatch = content.match(/provider\s*=\s*"([^"]+)"/);
      if (providerMatch) {
        const provider = providerMatch[1];
        if (provider === "postgresql") {
          return { type: "postgresql", orm: "Prisma", detectedFrom: "prisma/schema.prisma" };
        }
        if (provider === "mysql") {
          return { type: "mysql", orm: "Prisma", detectedFrom: "prisma/schema.prisma" };
        }
        if (provider === "sqlite") {
          return { type: "sqlite", orm: "Prisma", detectedFrom: "prisma/schema.prisma" };
        }
        if (provider === "mongodb") {
          return { type: "mongodb", orm: "Prisma", detectedFrom: "prisma/schema.prisma" };
        }
      }
      return null;
    },
  },
];

// =============================================================================
// MONOREPO DETECTION
// =============================================================================

const monorepoFiles = [
  "lerna.json",
  "pnpm-workspace.yaml",
  "turbo.json",
  "nx.json",
  "rush.json",
];

// =============================================================================
// MAIN DETECTION FUNCTION
// =============================================================================

export async function detectTechStack(projectPath: string): Promise<{
  techStack: TechStack;
  projectInfo: ProjectInfo;
  isMonorepo: boolean;
  monorepoType?: string;
}> {
  const techStack: TechStack = {
    languages: [],
    frameworks: { testing: [] },
    databases: [],
  };

  let projectInfo: ProjectInfo = {
    name: path.basename(projectPath),
  };

  // Check for monorepo
  let isMonorepo = false;
  let monorepoType: string | undefined;
  for (const file of monorepoFiles) {
    if (fs.existsSync(path.join(projectPath, file))) {
      isMonorepo = true;
      monorepoType = file.replace(".json", "").replace(".yaml", "");
      break;
    }
  }

  // Run config detectors
  for (const detector of configDetectors) {
    const filePath = path.join(projectPath, detector.file);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const detected = detector.detect(content, projectPath);

        // Merge languages (avoid duplicates)
        if (detected.languages) {
          for (const lang of detected.languages) {
            const existing = techStack.languages.find((l) => l.name === lang.name);
            if (!existing) {
              techStack.languages.push(lang);
            } else if (lang.version && !existing.version) {
              existing.version = lang.version;
            }
          }
        }

        // Merge frameworks
        if (detected.frameworks) {
          if (detected.frameworks.frontend && !techStack.frameworks.frontend) {
            techStack.frameworks.frontend = detected.frameworks.frontend;
          }
          if (detected.frameworks.backend && !techStack.frameworks.backend) {
            techStack.frameworks.backend = detected.frameworks.backend;
          }
          if (detected.frameworks.orm && !techStack.frameworks.orm) {
            techStack.frameworks.orm = detected.frameworks.orm;
          }
          if (detected.frameworks.testing) {
            for (const test of detected.frameworks.testing) {
              if (!techStack.frameworks.testing.find((t) => t.name === test.name)) {
                techStack.frameworks.testing.push(test);
              }
            }
          }
        }

        // Get project info
        if (detected.projectInfo && !projectInfo.detectedFrom) {
          projectInfo = detected.projectInfo;
        }
      } catch (e) {
        // Skip files that can't be parsed
        console.warn(`Warning: Could not parse ${detector.file}:`, e);
      }
    }
  }

  // Detect package manager
  for (const [file, manager] of Object.entries(packageManagerFiles)) {
    if (fs.existsSync(path.join(projectPath, file))) {
      techStack.packageManager = manager;
      break;
    }
  }

  // Detect databases
  for (const detector of databaseDetectors) {
    const filePath = path.join(projectPath, detector.file);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const db = detector.detect(content);
        if (db && !techStack.databases.find((d) => d.type === db.type)) {
          // Inherit ORM if detected from frameworks
          if (!db.orm && techStack.frameworks.orm) {
            db.orm = techStack.frameworks.orm.name;
          }
          techStack.databases.push(db);
        }
      } catch (e) {
        // Skip
      }
    }
  }

  // Mark primary language if not set
  if (techStack.languages.length > 0 && !techStack.languages.some((l) => l.primary)) {
    techStack.languages[0].primary = true;
  }

  return {
    techStack,
    projectInfo,
    isMonorepo,
    monorepoType,
  };
}

// =============================================================================
// FORMAT DETECTION RESULTS
// =============================================================================

export function formatDetectionResults(result: {
  techStack: TechStack;
  projectInfo: ProjectInfo;
  isMonorepo: boolean;
  monorepoType?: string;
}): string {
  const { techStack, projectInfo, isMonorepo, monorepoType } = result;
  let output = "";

  output += `📊 **Technology Stack Detected:**\n\n`;

  if (isMonorepo) {
    output += `🗂️  **Monorepo**: ${monorepoType}\n\n`;
  }

  // Languages
  output += `**Languages:**\n`;
  for (const lang of techStack.languages) {
    output += `- ${lang.name}`;
    if (lang.version) output += ` ${lang.version}`;
    if (lang.primary) output += ` (primary)`;
    output += ` (from ${lang.detectedFrom})\n`;
  }
  output += `\n`;

  // Frameworks
  output += `**Frameworks:**\n`;
  if (techStack.frameworks.frontend) {
    output += `- Frontend: ${techStack.frameworks.frontend.name}`;
    if (techStack.frameworks.frontend.version) {
      output += ` ${techStack.frameworks.frontend.version}`;
    }
    output += ` (from ${techStack.frameworks.frontend.detectedFrom})\n`;
  }
  if (techStack.frameworks.backend) {
    output += `- Backend: ${techStack.frameworks.backend.name}`;
    if (techStack.frameworks.backend.version) {
      output += ` ${techStack.frameworks.backend.version}`;
    }
    output += ` (from ${techStack.frameworks.backend.detectedFrom})\n`;
  }
  if (techStack.frameworks.frontend === undefined && techStack.frameworks.backend === undefined) {
    output += `- None detected\n`;
  }
  output += `\n`;

  // Testing
  output += `**Testing:**\n`;
  if (techStack.frameworks.testing.length > 0) {
    for (const test of techStack.frameworks.testing) {
      output += `- ${test.name}`;
      if (test.version) output += ` ${test.version}`;
      output += `\n`;
    }
  } else {
    output += `- None detected\n`;
  }
  output += `\n`;

  // Database
  output += `**Database:**\n`;
  if (techStack.databases.length > 0) {
    for (const db of techStack.databases) {
      output += `- ${db.type}`;
      if (db.name) output += ` (${db.name})`;
      if (db.orm) output += ` - ORM: ${db.orm}`;
      output += `\n`;
    }
  } else {
    output += `- None detected\n`;
  }
  output += `\n`;

  // Package Manager
  output += `**Package Manager:**\n`;
  output += `- ${techStack.packageManager || "Not detected"}\n`;

  return output;
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

if (require.main === module) {
  const projectPath = process.argv[2] || process.cwd();
  
  detectTechStack(projectPath)
    .then((result) => {
      console.log(formatDetectionResults(result));
      console.log("\n---\n");
      console.log("Is this correct? [Y/n]");
    })
    .catch((error) => {
      console.error("Error detecting tech stack:", error);
      process.exit(1);
    });
}

