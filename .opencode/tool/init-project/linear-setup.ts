/**
 * Linear Integration Setup
 * 
 * Utilities for setting up Linear integration during project initialization.
 * Uses Linear MCP for API calls.
 */

import type { LinearConfig } from "./config-generator";

// =============================================================================
// TYPES
// =============================================================================

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

export interface LinearProject {
  id: string;
  name: string;
  description?: string;
  state: string;
}

export interface LinearSetupResult {
  success: boolean;
  config: LinearConfig;
  error?: string;
}

// =============================================================================
// API KEY VALIDATION
// =============================================================================

export function validateApiKey(apiKey: string | undefined): {
  valid: boolean;
  error?: string;
} {
  if (!apiKey) {
    return {
      valid: false,
      error: "LINEAR_API_KEY environment variable not set",
    };
  }

  if (!apiKey.startsWith("lin_api_")) {
    return {
      valid: false,
      error: "Invalid LINEAR_API_KEY format. Should start with 'lin_api_'",
    };
  }

  return { valid: true };
}

export function checkLinearApiKey(): {
  found: boolean;
  envVar: string;
  instructions: string;
} {
  const apiKey = process.env.LINEAR_API_KEY;
  const found = validateApiKey(apiKey).valid;

  return {
    found,
    envVar: "LINEAR_API_KEY",
    instructions: `
To set up Linear integration:

1. Go to Linear → Settings → API → Personal API Keys
2. Create a new key with full access
3. Add to your environment:

   # macOS/Linux (add to ~/.zshrc or ~/.bashrc):
   export LINEAR_API_KEY="lin_api_..."
   
   # Windows PowerShell (add to profile):
   $env:LINEAR_API_KEY="lin_api_..."

4. Restart your terminal or run 'source ~/.zshrc'
`,
  };
}

// =============================================================================
// PROMPTS FOR LINEAR SETUP
// =============================================================================

export function getTeamSelectionPrompt(teams: LinearTeam[]): string {
  let prompt = `
🔍 **Fetching your Linear teams...**

**Available Teams:**
`;

  teams.forEach((team, index) => {
    prompt += `${index + 1}. ${team.name} (${team.key})\n`;
  });

  prompt += `
> Select team [1-${teams.length}]:
`;

  return prompt;
}

export function getProjectSetupPrompt(teamName: string): string {
  return `
**Project Setup for ${teamName}:**

1. Create new Linear project for this codebase
2. Use existing project: [will show list]
3. Skip project selection (use team-level tracking only)

> [Select 1-3]:
`;
}

export function getProjectCreationPrompt(defaultName: string): string {
  return `
**Creating New Project**

Project name [${defaultName}]:
> 

Project description (optional):
>
`;
}

// =============================================================================
// CONFIG GENERATION
// =============================================================================

export function createLinearConfig(options: {
  enabled: boolean;
  teamId?: string;
  teamName?: string;
  projectId?: string;
  projectName?: string;
}): LinearConfig {
  return {
    enabled: options.enabled,
    teamId: options.teamId,
    teamName: options.teamName,
    projectId: options.projectId,
    projectName: options.projectName,
  };
}

export function generateLinearWorkflowInstructions(config: LinearConfig): string {
  if (!config.enabled) {
    return `
## Linear Integration (Disabled)

Linear integration is not configured. To enable:

1. Set your LINEAR_API_KEY environment variable
2. Run \`/init-project\` again
3. Select your team and project

Benefits of Linear integration:
- Automatic issue tracking
- Branch name generation from issues
- Workflow automation
`;
  }

  return `
## Linear Workflow

### Setup
- **Team**: ${config.teamName || config.teamId}
${config.projectId ? `- **Project**: ${config.projectName || config.projectId}` : "- **Project**: Team-level tracking"}

### Workflow Rules

1. **Before Starting Work**
   - Create or find a Linear issue for the work
   - Get the branch name from the issue
   - Create your branch: \`git checkout -b {branch-name}\`

2. **During Work**
   - Reference issue ID in commits: \`feat(auth): add login [${config.teamId?.substring(0, 3) || "LIN"}-123]\`
   - Keep issue updated with progress

3. **After Work**
   - Link PR to Linear issue
   - Move issue to "In Review" when PR is ready
   - Issue auto-transitions when PR merges

### Commands

\`\`\`
# Create an issue
@linear-coordinator Create issue "Feature title"

# Get current issues
@linear-coordinator Show my assigned issues

# Update issue status
@linear-coordinator Move issue LIN-123 to "In Progress"
\`\`\`
`;
}

// =============================================================================
// INTERACTIVE SETUP FLOW
// =============================================================================

export interface LinearSetupOptions {
  projectName: string;
  skipIfNoApiKey?: boolean;
}

export interface LinearSetupFlow {
  step: "check_api_key" | "select_team" | "select_project" | "complete" | "skipped";
  message: string;
  options?: string[];
  config: Partial<LinearConfig>;
}

/**
 * Get the next step in the Linear setup flow
 */
export function getLinearSetupStep(
  currentStep: LinearSetupFlow["step"],
  userInput?: string,
  context?: {
    teams?: LinearTeam[];
    projects?: LinearProject[];
    selectedTeam?: LinearTeam;
    options?: LinearSetupOptions;
  },
): LinearSetupFlow {
  switch (currentStep) {
    case "check_api_key": {
      const apiKeyCheck = checkLinearApiKey();
      
      if (!apiKeyCheck.found) {
        if (context?.options?.skipIfNoApiKey) {
          return {
            step: "skipped",
            message: "⚠️ LINEAR_API_KEY not found. Skipping Linear setup.",
            config: { enabled: false },
          };
        }
        
        return {
          step: "check_api_key",
          message: `⚠️ LINEAR_API_KEY not found\n${apiKeyCheck.instructions}\n\nOptions:\n1. I've added the key - continue\n2. Skip Linear setup (not recommended)`,
          options: ["1", "2"],
          config: { enabled: false },
        };
      }
      
      return {
        step: "select_team",
        message: "✅ LINEAR_API_KEY found. Fetching teams...",
        config: { enabled: true },
      };
    }

    case "select_team": {
      if (!context?.teams || context.teams.length === 0) {
        return {
          step: "skipped",
          message: "⚠️ No Linear teams found. Please create a team in Linear first.",
          config: { enabled: false },
        };
      }

      const teamIndex = parseInt(userInput || "1", 10) - 1;
      if (teamIndex >= 0 && teamIndex < context.teams.length) {
        const team = context.teams[teamIndex];
        return {
          step: "select_project",
          message: `✅ Selected team: ${team.name}\n\n${getProjectSetupPrompt(team.name)}`,
          options: ["1", "2", "3"],
          config: {
            enabled: true,
            teamId: team.id,
            teamName: team.name,
          },
        };
      }

      return {
        step: "select_team",
        message: `Invalid selection. ${getTeamSelectionPrompt(context.teams)}`,
        options: context.teams.map((_, i) => String(i + 1)),
        config: { enabled: true },
      };
    }

    case "select_project": {
      const choice = userInput || "3";
      
      if (choice === "1") {
        // Create new project
        const defaultName = context?.options?.projectName || "New Project";
        return {
          step: "complete",
          message: getProjectCreationPrompt(defaultName),
          config: {
            enabled: true,
            teamId: context?.selectedTeam?.id,
            teamName: context?.selectedTeam?.name,
            // Project will be created later
          },
        };
      }
      
      if (choice === "2" && context?.projects && context.projects.length > 0) {
        // Use existing project - would need another prompt
        return {
          step: "complete",
          message: "Project selection complete.",
          config: {
            enabled: true,
            teamId: context?.selectedTeam?.id,
            teamName: context?.selectedTeam?.name,
            projectId: context.projects[0].id,
            projectName: context.projects[0].name,
          },
        };
      }
      
      // Skip project selection
      return {
        step: "complete",
        message: "✅ Linear setup complete (team-level tracking)",
        config: {
          enabled: true,
          teamId: context?.selectedTeam?.id,
          teamName: context?.selectedTeam?.name,
        },
      };
    }

    case "complete":
    case "skipped":
    default:
      return {
        step: "complete",
        message: "Linear setup complete.",
        config: { enabled: false },
      };
  }
}

// =============================================================================
// FORMAT OUTPUT
// =============================================================================

export function formatLinearSetupSummary(config: LinearConfig): string {
  if (!config.enabled) {
    return `
📋 **Linear Integration**: Disabled

To enable later:
1. Set LINEAR_API_KEY environment variable
2. Run \`/init-project\` to reconfigure
`;
  }

  return `
📋 **Linear Integration**: Enabled

**Team**: ${config.teamName || config.teamId}
${config.projectId ? `**Project**: ${config.projectName || config.projectId}` : "**Project**: Team-level tracking"}

Linear workflow has been configured. See AGENTS.md for usage instructions.
`;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  validateApiKey,
  checkLinearApiKey,
  getTeamSelectionPrompt,
  getProjectSetupPrompt,
  getProjectCreationPrompt,
  createLinearConfig,
  generateLinearWorkflowInstructions,
  getLinearSetupStep,
  formatLinearSetupSummary,
};

