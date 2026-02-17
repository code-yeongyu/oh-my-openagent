import { createSystemDirective, SystemDirectiveTypes } from "../../shared/system-directive"
import { getAgentDisplayName } from "../../shared/agent-display-names"

export const HOOK_NAME = "coeus-md-only"

export const COEUS_AGENTS = ["coeus", "sub-prometheus"]

export const ALLOWED_EXTENSIONS = [".md", ".json"]

export const ALLOWED_PATH_PREFIX = ".sisyphus"

export const BLOCKED_FILES = ["boulder.json"]

export const BLOCKED_TOOLS = ["Write", "Edit", "write", "edit"]

export const PLANNING_CONSULT_WARNING = `

---

${createSystemDirective(SystemDirectiveTypes.COEUS_READ_ONLY)}

You are being invoked by ${getAgentDisplayName("coeus")}, a READ-ONLY recursive planning agent.

**CRITICAL CONSTRAINTS:**
- DO NOT modify any files (no Write, Edit, or any file mutations)
- DO NOT execute commands that change system state
- DO NOT create, delete, or rename files
- ONLY provide analysis, recommendations, and information

**YOUR ROLE**: Provide consultation, research, and analysis to assist with recursive planning.
Return your findings and recommendations. The actual implementation will be handled separately after planning is complete.

---

`
