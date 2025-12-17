/**
 * Init-Project Tests
 * 
 * Tests for the init-project command utilities covering:
 * 1. TypeScript/React new project
 * 2. Python/FastAPI existing project  
 * 3. Monorepo structure
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  typescriptReactProject,
  pythonFastApiProject,
  monorepoProject,
} from "./test-fixtures";
import { detectTechStack, formatDetectionResults } from "../tech-detection";
import {
  suggestArchitecture,
  getSuggestionReason,
  generateOpencodeJson,
  generateProjectContextYaml,
  ARCHITECTURE_PATTERNS,
  type InitProjectConfig,
} from "../config-generator";
import {
  generateRootAgentsMd,
  generateAgentsMdFiles,
} from "../agents-generator";
import {
  checkExistingConfiguration,
  detectMonorepo,
} from "../edge-cases";
import { runInitProject, generateSummary } from "../runner";

// =============================================================================
// TEST UTILITIES
// =============================================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "init-project-test-"));
}

function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeTestFiles(dir: string, files: Record<string, string>): void {
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    const fileDir = path.dirname(fullPath);
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content);
  }
}

// =============================================================================
// TEST SUITE 1: TypeScript/React New Project
// =============================================================================

describe("TypeScript/React New Project", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe("Technology Detection", () => {
    it("should detect TypeScript from package.json", async () => {
      writeTestFiles(tempDir, {
        "package.json": JSON.stringify(typescriptReactProject.packageJson, null, 2),
        "tsconfig.json": JSON.stringify(typescriptReactProject.tsconfig, null, 2),
        "pnpm-lock.yaml": "# pnpm lockfile",
      });

      const result = await detectTechStack(tempDir);

      expect(result.techStack.languages).toContainEqual(
        expect.objectContaining({
          name: "TypeScript",
          primary: true,
        }),
      );
    });

    it("should detect React as frontend framework", async () => {
      writeTestFiles(tempDir, {
        "package.json": JSON.stringify(typescriptReactProject.packageJson, null, 2),
      });

      const result = await detectTechStack(tempDir);

      expect(result.techStack.frameworks.frontend).toEqual(
        expect.objectContaining({
          name: "React",
        }),
      );
    });

    it("should detect Vitest as testing framework", async () => {
      writeTestFiles(tempDir, {
        "package.json": JSON.stringify(typescriptReactProject.packageJson, null, 2),
      });

      const result = await detectTechStack(tempDir);

      expect(result.techStack.frameworks.testing).toContainEqual(
        expect.objectContaining({
          name: "Vitest",
        }),
      );
    });

    it("should detect pnpm as package manager", async () => {
      writeTestFiles(tempDir, {
        "package.json": JSON.stringify(typescriptReactProject.packageJson, null, 2),
        "pnpm-lock.yaml": "# pnpm lockfile",
      });

      const result = await detectTechStack(tempDir);

      expect(result.techStack.packageManager).toBe("pnpm");
    });

    it("should extract project info from package.json", async () => {
      writeTestFiles(tempDir, {
        "package.json": JSON.stringify(typescriptReactProject.packageJson, null, 2),
      });

      const result = await detectTechStack(tempDir);

      expect(result.projectInfo.name).toBe("my-react-app");
      expect(result.projectInfo.description).toBe("A modern React application with TypeScript");
    });
  });

  describe("Architecture Suggestion", () => {
    it("should suggest layered architecture for web-app", () => {
      const suggestion = suggestArchitecture("web-app");

      expect(suggestion.id).toBe("layered");
    });

    it("should provide reason for suggestion", () => {
      const suggestion = suggestArchitecture("web-app");
      const reason = getSuggestionReason("web-app", suggestion);

      expect(reason).toBeTruthy();
      expect(reason.length).toBeGreaterThan(10);
    });
  });

  describe("Config Generation", () => {
    it("should generate valid opencode.json", () => {
      const config: InitProjectConfig = {
        projectInfo: typescriptReactProject.projectInfo,
        projectType: "web-app",
        techStack: typescriptReactProject.techStack,
        architecture: ARCHITECTURE_PATTERNS[0], // layered
        linear: { enabled: false },
        mintlify: { enabled: false, docsPath: "docs/" },
        isExisting: false,
      };

      const opencodeJson = generateOpencodeJson(config);
      const parsed = JSON.parse(opencodeJson);

      expect(parsed.$schema).toBe("https://opencode.ai/config.json");
      expect(parsed.model).toBeTruthy();
      expect(parsed.lsp).toBeDefined();
      expect(parsed.lsp.typescript).toBeDefined();
    });

    it("should generate valid project-context.yaml", () => {
      const config: InitProjectConfig = {
        projectInfo: typescriptReactProject.projectInfo,
        projectType: "web-app",
        techStack: typescriptReactProject.techStack,
        architecture: ARCHITECTURE_PATTERNS[0],
        linear: { enabled: false },
        mintlify: { enabled: false, docsPath: "docs/" },
        isExisting: false,
      };

      const yaml = generateProjectContextYaml(config);

      expect(yaml).toContain("name: \"my-react-app\"");
      expect(yaml).toContain("type: \"web-app\"");
      expect(yaml).toContain("pattern: \"layered\"");
    });
  });

  describe("AGENTS.md Generation", () => {
    it("should generate root AGENTS.md with project info", () => {
      const config: InitProjectConfig = {
        projectInfo: typescriptReactProject.projectInfo,
        projectType: "web-app",
        techStack: typescriptReactProject.techStack,
        architecture: ARCHITECTURE_PATTERNS[0],
        linear: { enabled: false },
        mintlify: { enabled: false, docsPath: "docs/" },
        isExisting: false,
      };

      const agentsMd = generateRootAgentsMd(config);

      expect(agentsMd).toContain("my-react-app");
      expect(agentsMd).toContain("TypeScript");
      expect(agentsMd).toContain("React");
      expect(agentsMd).toContain("Layered");
    });
  });

  describe("Full Integration", () => {
    it("should complete init-project for new React app", async () => {
      writeTestFiles(tempDir, {
        "package.json": JSON.stringify(typescriptReactProject.packageJson, null, 2),
        "pnpm-lock.yaml": "# pnpm lockfile",
      });

      // Copy templates for the test
      const templatesDir = path.join(tempDir, ".opencode/templates/architectures/layered");
      fs.mkdirSync(templatesDir, { recursive: true });

      const result = await runInitProject({
        projectPath: tempDir,
        preset: {
          projectInfo: typescriptReactProject.projectInfo,
          projectType: "web-app",
          techStack: typescriptReactProject.techStack,
          architecture: ARCHITECTURE_PATTERNS[0],
          linear: { enabled: false },
          mintlify: { enabled: false, docsPath: "docs/" },
        },
      });

      expect(result.success).toBe(true);
      expect(result.createdFiles).toContain(".opencode/opencode.json");
      expect(result.createdFiles).toContain(".opencode/project-context.yaml");
      expect(result.createdFiles).toContain("AGENTS.md");

      // Verify files exist
      expect(fs.existsSync(path.join(tempDir, ".opencode/opencode.json"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "AGENTS.md"))).toBe(true);
    });
  });
});

// =============================================================================
// TEST SUITE 2: Python/FastAPI Existing Project
// =============================================================================

describe("Python/FastAPI Existing Project", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe("Technology Detection", () => {
    it("should detect Python from pyproject.toml", async () => {
      writeTestFiles(tempDir, {
        "pyproject.toml": pythonFastApiProject.pyprojectToml,
        "poetry.lock": "# poetry lockfile",
      });

      const result = await detectTechStack(tempDir);

      expect(result.techStack.languages).toContainEqual(
        expect.objectContaining({
          name: "Python",
          primary: true,
        }),
      );
    });

    it("should detect FastAPI as backend framework", async () => {
      writeTestFiles(tempDir, {
        "pyproject.toml": pythonFastApiProject.pyprojectToml,
      });

      const result = await detectTechStack(tempDir);

      expect(result.techStack.frameworks.backend).toEqual(
        expect.objectContaining({
          name: "FastAPI",
        }),
      );
    });

    it("should detect PostgreSQL from docker-compose", async () => {
      writeTestFiles(tempDir, {
        "pyproject.toml": pythonFastApiProject.pyprojectToml,
        "docker-compose.yml": pythonFastApiProject.dockerCompose,
      });

      const result = await detectTechStack(tempDir);

      expect(result.techStack.databases).toContainEqual(
        expect.objectContaining({
          type: "postgresql",
        }),
      );
    });

    it("should detect pytest as testing framework", async () => {
      writeTestFiles(tempDir, {
        "pyproject.toml": pythonFastApiProject.pyprojectToml,
      });

      const result = await detectTechStack(tempDir);

      expect(result.techStack.frameworks.testing).toContainEqual(
        expect.objectContaining({
          name: "pytest",
        }),
      );
    });

    it("should detect poetry as package manager", async () => {
      writeTestFiles(tempDir, {
        "pyproject.toml": pythonFastApiProject.pyprojectToml,
        "poetry.lock": "# poetry lockfile",
      });

      const result = await detectTechStack(tempDir);

      expect(result.techStack.packageManager).toBe("poetry");
    });
  });

  describe("Architecture Suggestion", () => {
    it("should suggest layered architecture for API service", () => {
      const suggestion = suggestArchitecture("api");

      expect(suggestion.id).toBe("layered");
    });
  });

  describe("Config Generation", () => {
    it("should generate opencode.json with Python LSP config", () => {
      const config: InitProjectConfig = {
        projectInfo: pythonFastApiProject.projectInfo,
        projectType: "api",
        techStack: pythonFastApiProject.techStack,
        architecture: ARCHITECTURE_PATTERNS[0],
        linear: { enabled: false },
        mintlify: { enabled: false, docsPath: "docs/" },
        isExisting: true,
      };

      const opencodeJson = generateOpencodeJson(config);
      const parsed = JSON.parse(opencodeJson);

      expect(parsed.lsp.python).toBeDefined();
      expect(parsed.permission.bash.pytest).toBe("allow");
    });

    it("should generate project-context.yaml with PostgreSQL database", () => {
      const config: InitProjectConfig = {
        projectInfo: pythonFastApiProject.projectInfo,
        projectType: "api",
        techStack: pythonFastApiProject.techStack,
        architecture: ARCHITECTURE_PATTERNS[0],
        linear: { enabled: false },
        mintlify: { enabled: false, docsPath: "docs/" },
        isExisting: true,
      };

      const yaml = generateProjectContextYaml(config);

      expect(yaml).toContain("type: \"postgresql\"");
      expect(yaml).toContain("orm: \"SQLAlchemy\"");
    });
  });

  describe("Existing Project Detection", () => {
    it("should detect existing .opencode directory", () => {
      // Create existing config
      const opencodeDir = path.join(tempDir, ".opencode");
      fs.mkdirSync(opencodeDir, { recursive: true });
      fs.writeFileSync(path.join(opencodeDir, "opencode.json"), "{}");

      const check = checkExistingConfiguration(tempDir);

      expect(check.exists).toBe(true);
      expect(check.files).toContain(".opencode/opencode.json");
    });
  });
});

// =============================================================================
// TEST SUITE 3: Monorepo Structure
// =============================================================================

describe("Monorepo Structure", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe("Monorepo Detection", () => {
    it("should detect pnpm workspace monorepo", () => {
      writeTestFiles(tempDir, {
        "pnpm-workspace.yaml": monorepoProject.pnpmWorkspaceYaml!,
        "package.json": JSON.stringify(monorepoProject.rootPackageJson, null, 2),
      });

      const info = detectMonorepo(tempDir);

      expect(info.isMonorepo).toBe(true);
      expect(info.type).toBe("pnpm");
    });

    it("should detect turbo monorepo", () => {
      writeTestFiles(tempDir, {
        "turbo.json": JSON.stringify(monorepoProject.turboJson, null, 2),
        "package.json": JSON.stringify(monorepoProject.rootPackageJson, null, 2),
      });

      const info = detectMonorepo(tempDir);

      expect(info.isMonorepo).toBe(true);
      expect(info.type).toBe("turbo");
    });

    it("should detect packages in monorepo", () => {
      // Create package structure
      writeTestFiles(tempDir, {
        "pnpm-workspace.yaml": monorepoProject.pnpmWorkspaceYaml!,
        "package.json": JSON.stringify(monorepoProject.rootPackageJson, null, 2),
        "packages/web/package.json": JSON.stringify({ name: "@my-monorepo/web" }),
        "packages/api/package.json": JSON.stringify({ name: "@my-monorepo/api" }),
        "packages/shared/package.json": JSON.stringify({ name: "@my-monorepo/shared" }),
      });

      const info = detectMonorepo(tempDir);

      expect(info.packages.length).toBe(3);
      expect(info.packages).toContain("packages/web");
      expect(info.packages).toContain("packages/api");
      expect(info.packages).toContain("packages/shared");
    });
  });

  describe("Tech Detection in Monorepo", () => {
    it("should detect TypeScript in monorepo root", async () => {
      writeTestFiles(tempDir, {
        "package.json": JSON.stringify({
          ...monorepoProject.rootPackageJson,
          devDependencies: {
            ...monorepoProject.rootPackageJson.devDependencies,
            typescript: "^5.3.0",
          },
        }, null, 2),
        "pnpm-lock.yaml": "# lock",
      });

      const result = await detectTechStack(tempDir);

      expect(result.techStack.languages).toContainEqual(
        expect.objectContaining({
          name: "TypeScript",
        }),
      );
      expect(result.isMonorepo).toBe(true);
    });
  });

  describe("Architecture Suggestion", () => {
    it("should suggest feature-based architecture for monorepo", () => {
      const suggestion = suggestArchitecture("monorepo");

      expect(suggestion.id).toBe("feature-based");
    });
  });

  describe("Config Generation for Monorepo", () => {
    it("should generate valid config for monorepo", () => {
      const config: InitProjectConfig = {
        projectInfo: monorepoProject.projectInfo,
        projectType: "monorepo",
        techStack: monorepoProject.techStack,
        architecture: ARCHITECTURE_PATTERNS.find((p) => p.id === "feature-based")!,
        linear: { enabled: false },
        mintlify: { enabled: false, docsPath: "docs/" },
        isExisting: false,
      };

      const yaml = generateProjectContextYaml(config);

      expect(yaml).toContain("type: \"monorepo\"");
      expect(yaml).toContain("pattern: \"feature-based\"");
    });
  });
});

// =============================================================================
// TEST SUITE 4: Summary Generation
// =============================================================================

describe("Summary Generation", () => {
  it("should generate comprehensive summary", () => {
    const result = {
      success: true,
      config: {
        projectInfo: typescriptReactProject.projectInfo,
        projectType: "web-app",
        techStack: typescriptReactProject.techStack,
        architecture: ARCHITECTURE_PATTERNS[0],
        linear: { enabled: false },
        mintlify: { enabled: false, docsPath: "docs/" },
        isExisting: false,
      } as InitProjectConfig,
      createdFiles: [
        ".opencode/opencode.json",
        ".opencode/project-context.yaml",
        "AGENTS.md",
        "src/controllers/AGENTS.md",
        "src/services/AGENTS.md",
      ],
      errors: [],
      warnings: [],
    };

    const summary = generateSummary(result);

    expect(summary).toContain("Project Initialized Successfully");
    expect(summary).toContain("my-react-app");
    expect(summary).toContain("TypeScript");
    expect(summary).toContain("React");
    expect(summary).toContain("Available Agents");
    expect(summary).toContain("Next Steps");
  });
});

