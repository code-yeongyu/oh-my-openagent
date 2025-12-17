import { tool } from "@opencode-ai/plugin";
import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";

/**
 * Project Context Reader Tool
 *
 * Read and parse the project-context.yaml file, providing typed access
 * to project configuration for agents.
 *
 * This tool provides access to project-specific settings including:
 * - Project metadata (name, type, description)
 * - Technology stack
 * - Architecture pattern and layers
 * - Integration settings (Linear, Mintlify)
 * - Coding conventions
 */

type SectionName =
  | "all"
  | "project"
  | "tech_stack"
  | "architecture"
  | "integrations"
  | "conventions";

interface ProjectContext {
  project?: {
    name?: string;
    type?: string;
    description?: string;
    [key: string]: unknown;
  };
  tech_stack?: {
    languages?: string[];
    frameworks?: string[];
    databases?: string[];
    [key: string]: unknown;
  };
  architecture?: {
    pattern?: string;
    layers?: string[];
    [key: string]: unknown;
  };
  integrations?: {
    linear?: {
      enabled?: boolean;
      team_id?: string;
      [key: string]: unknown;
    };
    mintlify?: {
      enabled?: boolean;
      docs_path?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  conventions?: {
    naming?: {
      [key: string]: string;
    };
    style?: {
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface SuccessResultAll {
  success: true;
  context: ProjectContext;
  initialized: true;
}

interface SuccessResultSection {
  success: true;
  section: SectionName;
  data: unknown;
  initialized: true;
}

interface ErrorResult {
  success: false;
  error: string;
  suggestion?: string;
  initialized?: boolean;
  availableSections?: string[];
}

type ContextResult = SuccessResultAll | SuccessResultSection | ErrorResult;

/**
 * Valid sections in project-context.yaml
 */
const VALID_SECTIONS: SectionName[] = [
  "all",
  "project",
  "tech_stack",
  "architecture",
  "integrations",
  "conventions",
];

/**
 * Default paths to check for project context file
 */
const CONTEXT_PATHS = [
  ".opencode/project-context.yaml",
  ".opencode/project-context.yml",
  "project-context.yaml",
  "project-context.yml",
];

/**
 * Find the project context file
 */
function findContextFile(): string | null {
  for (const path of CONTEXT_PATHS) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

export default tool({
  description:
    "Read project context and configuration. Use this to understand project-specific settings, architecture, and conventions.",

  args: {
    section: tool.schema
      .enum(["all", "project", "tech_stack", "architecture", "integrations", "conventions"])
      .optional()
      .describe("Specific section to retrieve (default: all)"),
  },

  async execute(args): Promise<string> {
    const contextPath = findContextFile();

    // Check if context file exists
    if (!contextPath) {
      const result: ErrorResult = {
        success: false,
        error: "project-context.yaml not found",
        suggestion:
          "Run /init-project to create project configuration. Checked paths: " +
          CONTEXT_PATHS.join(", "),
        initialized: false,
      };
      return JSON.stringify(result, null, 2);
    }

    try {
      // Read and parse YAML
      const content = readFileSync(contextPath, "utf-8");

      if (!content.trim()) {
        const result: ErrorResult = {
          success: false,
          error: "project-context.yaml is empty",
          suggestion: "Re-run /init-project to regenerate configuration",
          initialized: false,
        };
        return JSON.stringify(result, null, 2);
      }

      let projectContext: ProjectContext;

      try {
        projectContext = parseYaml(content) as ProjectContext;
      } catch (parseError) {
        const errorMessage =
          parseError instanceof Error ? parseError.message : String(parseError);
        const result: ErrorResult = {
          success: false,
          error: `Invalid YAML syntax in project-context.yaml: ${errorMessage}`,
          suggestion: "Fix YAML syntax errors or re-run /init-project",
          initialized: false,
        };
        return JSON.stringify(result, null, 2);
      }

      // Validate structure
      if (!projectContext || typeof projectContext !== "object") {
        const result: ErrorResult = {
          success: false,
          error: "Invalid project-context.yaml format - expected an object",
          suggestion: "Re-run /init-project to regenerate configuration",
          initialized: false,
        };
        return JSON.stringify(result, null, 2);
      }

      const section = (args.section || "all") as SectionName;

      // Return requested section
      if (section === "all") {
        const result: SuccessResultAll = {
          success: true,
          context: projectContext,
          initialized: true,
        };
        return JSON.stringify(result, null, 2);
      }

      // Validate section name
      if (!VALID_SECTIONS.includes(section)) {
        const result: ErrorResult = {
          success: false,
          error: `Invalid section '${section}'`,
          availableSections: VALID_SECTIONS.filter((s) => s !== "all"),
        };
        return JSON.stringify(result, null, 2);
      }

      // Check if section exists in context
      if (!(section in projectContext)) {
        const result: ErrorResult = {
          success: false,
          error: `Section '${section}' not found in project context`,
          availableSections: Object.keys(projectContext),
        };
        return JSON.stringify(result, null, 2);
      }

      const result: SuccessResultSection = {
        success: true,
        section,
        data: projectContext[section],
        initialized: true,
      };
      return JSON.stringify(result, null, 2);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const result: ErrorResult = {
        success: false,
        error: `Failed to read project context: ${errorMessage}`,
        initialized: false,
      };
      return JSON.stringify(result, null, 2);
    }
  },
});

