/**
 * Test Fixtures for Init-Project
 * 
 * Provides sample data for testing different project scenarios.
 */

import type { TechStack, ProjectInfo } from "../tech-detection";
import type { InitProjectConfig, ArchitecturePattern } from "../config-generator";

// =============================================================================
// FIXTURE: TypeScript/React New Project
// =============================================================================

export const typescriptReactProject = {
  projectInfo: {
    name: "my-react-app",
    description: "A modern React application with TypeScript",
    version: "0.1.0",
    detectedFrom: "package.json",
  } as ProjectInfo,

  techStack: {
    languages: [
      { name: "TypeScript", version: "5.3", primary: true, detectedFrom: "package.json" },
    ],
    frameworks: {
      frontend: { name: "React", version: "18.2.0", type: "frontend" as const, detectedFrom: "package.json" },
      backend: undefined,
      testing: [
        { name: "Vitest", version: "1.0.0", type: "testing" as const, detectedFrom: "package.json" },
      ],
    },
    databases: [],
    packageManager: "pnpm",
  } as TechStack,

  packageJson: {
    name: "my-react-app",
    version: "0.1.0",
    description: "A modern React application with TypeScript",
    dependencies: {
      "react": "^18.2.0",
      "react-dom": "^18.2.0",
    },
    devDependencies: {
      "typescript": "^5.3.0",
      "vitest": "^1.0.0",
      "@types/react": "^18.2.0",
      "@types/react-dom": "^18.2.0",
    },
    engines: {
      node: ">=18",
    },
  },

  tsconfig: {
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "bundler",
      jsx: "react-jsx",
      strict: true,
    },
    include: ["src"],
  },
};

// =============================================================================
// FIXTURE: Python/FastAPI Existing Project
// =============================================================================

export const pythonFastApiProject = {
  projectInfo: {
    name: "fastapi-service",
    description: "A FastAPI backend service",
    version: "1.0.0",
    detectedFrom: "pyproject.toml",
  } as ProjectInfo,

  techStack: {
    languages: [
      { name: "Python", version: "3.12", primary: true, detectedFrom: "pyproject.toml" },
    ],
    frameworks: {
      frontend: undefined,
      backend: { name: "FastAPI", version: "0.109.0", type: "backend" as const, detectedFrom: "pyproject.toml" },
      testing: [
        { name: "pytest", type: "testing" as const, detectedFrom: "pyproject.toml" },
      ],
      orm: { name: "SQLAlchemy", type: "orm" as const, detectedFrom: "pyproject.toml" },
    },
    databases: [
      { type: "postgresql", name: "main", orm: "SQLAlchemy", detectedFrom: "docker-compose.yml" },
    ],
    packageManager: "poetry",
  } as TechStack,

  pyprojectToml: `[tool.poetry]
name = "fastapi-service"
version = "1.0.0"
description = "A FastAPI backend service"
authors = ["Developer <dev@example.com>"]

[tool.poetry.dependencies]
python = "^3.12"
fastapi = "^0.109.0"
uvicorn = "^0.25.0"
sqlalchemy = "^2.0.0"
pydantic = "^2.5.0"

[tool.poetry.group.dev.dependencies]
pytest = "^7.4.0"
pytest-asyncio = "^0.23.0"
ruff = "^0.1.0"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
`,

  dockerCompose: `version: '3.8'

services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
`,
};

// =============================================================================
// FIXTURE: Monorepo Structure
// =============================================================================

export const monorepoProject = {
  projectInfo: {
    name: "my-monorepo",
    description: "A monorepo with multiple packages",
    version: "0.0.0",
    detectedFrom: "package.json",
  } as ProjectInfo,

  techStack: {
    languages: [
      { name: "TypeScript", version: "5.3", primary: true, detectedFrom: "package.json" },
    ],
    frameworks: {
      frontend: { name: "React", version: "18.2.0", type: "frontend" as const, detectedFrom: "packages/web/package.json" },
      backend: { name: "Express", version: "4.18.0", type: "backend" as const, detectedFrom: "packages/api/package.json" },
      testing: [
        { name: "Vitest", type: "testing" as const, detectedFrom: "package.json" },
      ],
    },
    databases: [
      { type: "postgresql", orm: "Prisma", detectedFrom: "packages/api/prisma/schema.prisma" },
    ],
    packageManager: "pnpm",
  } as TechStack,

  packages: ["packages/web", "packages/api", "packages/shared"],

  rootPackageJson: {
    name: "my-monorepo",
    private: true,
    scripts: {
      build: "turbo build",
      dev: "turbo dev",
      lint: "turbo lint",
      test: "turbo test",
    },
    devDependencies: {
      turbo: "^1.11.0",
      typescript: "^5.3.0",
    },
  },

  pnpmWorkspaceYaml: `packages:
  - 'packages/*'
`,

  turboJson: {
    "$schema": "https://turbo.build/schema.json",
    pipeline: {
      build: {
        dependsOn: ["^build"],
        outputs: ["dist/**"],
      },
      lint: {},
      test: {},
      dev: {
        cache: false,
        persistent: true,
      },
    },
  },
};

// =============================================================================
// EXPECTED CONFIG OUTPUTS
// =============================================================================

export function getExpectedConfig(
  projectInfo: ProjectInfo,
  techStack: TechStack,
  architecture: ArchitecturePattern,
): Partial<InitProjectConfig> {
  return {
    projectInfo,
    techStack,
    architecture,
    linear: { enabled: false },
    mintlify: { enabled: false, docsPath: "docs/" },
    isExisting: false,
  };
}

// =============================================================================
// FILE SYSTEM SETUP HELPERS
// =============================================================================

export interface MockFileSystem {
  files: Record<string, string>;
  directories: string[];
}

export function createMockFileSystem(fixture: {
  packageJson?: object;
  tsconfig?: object;
  pyprojectToml?: string;
  dockerCompose?: string;
  turboJson?: object;
  pnpmWorkspaceYaml?: string;
}): MockFileSystem {
  const files: Record<string, string> = {};
  const directories: string[] = [];

  if (fixture.packageJson) {
    files["package.json"] = JSON.stringify(fixture.packageJson, null, 2);
  }

  if (fixture.tsconfig) {
    files["tsconfig.json"] = JSON.stringify(fixture.tsconfig, null, 2);
  }

  if (fixture.pyprojectToml) {
    files["pyproject.toml"] = fixture.pyprojectToml;
  }

  if (fixture.dockerCompose) {
    files["docker-compose.yml"] = fixture.dockerCompose;
  }

  if (fixture.turboJson) {
    files["turbo.json"] = JSON.stringify(fixture.turboJson, null, 2);
  }

  if (fixture.pnpmWorkspaceYaml) {
    files["pnpm-workspace.yaml"] = fixture.pnpmWorkspaceYaml;
  }

  return { files, directories };
}

// Note: All fixtures and functions are exported at their definitions above

