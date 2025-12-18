import type { AgentRole } from "../agents/types"

/**
 * Tool configuration by agent role.
 * Determines which tools are enabled/disabled for each role.
 *
 * CRITICAL: This enforces the delegation hierarchy:
 * - team-lead → can delegate to anyone
 * - manager → can delegate to specialists only (no call_omo_agent to prevent loops)
 * - specialist/advisor/utility → cannot delegate
 *
 * @see .cursor/specs/LIF-62-feat-multi-layered-orchestration/plan.md
 */
export const TOOL_CONFIG_BY_ROLE: Record<AgentRole, Record<string, boolean>> = {
  "team-lead": {
    // Full access to all delegation tools
    task: true,
    background_task: true,
    call_omo_agent: true,
    // File tools: enabled
    write: true,
    edit: true,
    // Governance tools: enabled
    linear_branch: true,
    linear_update_status: true,
    linear_create_issue: true,
    create_spec_folder: true,
    read_context: true,
  },

  manager: {
    // Can delegate DOWN but not UP
    task: true,              // ✅ CAN delegate to specialists
    background_task: true,   // ✅ CAN run background tasks
    call_omo_agent: false,   // ❌ Cannot call back to OmO (prevents loops)
    // File tools: enabled with governance
    write: true,
    edit: true,
    // Governance tools: enabled (except issue/spec creation)
    linear_branch: true,
    linear_update_status: true,
    linear_create_issue: false,  // Only team-lead creates issues
    create_spec_folder: false,   // Only team-lead creates specs
    read_context: true,
  },

  specialist: {
    // TERMINAL: Cannot delegate further
    task: false,             // ❌ CANNOT delegate
    background_task: false,  // ❌ CANNOT run background tasks
    call_omo_agent: false,   // ❌ CANNOT call OmO
    // File tools: enabled with governance
    write: true,
    edit: true,
    // Governance tools: limited
    linear_branch: true,
    linear_update_status: true,
    linear_create_issue: false,
    create_spec_folder: false,
    read_context: true,
  },

  advisor: {
    // Read-only: Strategic guidance, no file modifications
    task: false,
    background_task: false,
    call_omo_agent: false,
    write: false,            // ❌ Read-only
    edit: false,             // ❌ Read-only
    linear_branch: false,
    linear_update_status: false,
    linear_create_issue: false,
    create_spec_folder: false,
    read_context: true,
  },

  utility: {
    // Read-only: Research and exploration
    task: false,
    background_task: false,
    call_omo_agent: false,
    write: false,            // ❌ Read-only
    edit: false,             // ❌ Read-only
    linear_branch: false,
    linear_update_status: false,
    linear_create_issue: false,
    create_spec_folder: false,
    read_context: true,
  },
}

/**
 * Get tool configuration for an agent based on its role.
 * Used by call_omo_agent and background_task tools to apply role-based restrictions.
 *
 * @param role - The agent role
 * @returns Tool configuration object with boolean values for each tool
 */
export function getToolConfigForRole(role: AgentRole): Record<string, boolean> {
  return TOOL_CONFIG_BY_ROLE[role]
}

/**
 * Check if an agent role can delegate to other agents.
 *
 * @param role - The agent role to check
 * @returns true if the role can use task/call_omo_agent tools
 */
export function canDelegate(role: AgentRole): boolean {
  return role === "team-lead" || role === "manager"
}
