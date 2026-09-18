export declare const HOOK_NAME = "prometheus-md-only";
export declare const PROMETHEUS_AGENT = "prometheus";
export declare const ALLOWED_EXTENSIONS: string[];
export declare const ALLOWED_PATH_PREFIX = ".omo";
export declare const BLOCKED_TOOLS: string[];
/**
 * XML-tag wrapper used to mark the planning-context boundary in prompts
 * forwarded to external LLMs via task(). This format intentionally avoids
 * the `[SYSTEM DIRECTIVE: ...]` bracket syntax that Azure OpenAI Prompt Shield
 * flags as indirect prompt injection in user-role content (#4036).
 */
export declare const PLANNING_CONTEXT_OPEN = "<planning-context source=\"prometheus-read-only\">";
export declare const PLANNING_CONTEXT_CLOSE = "</planning-context>";
export declare const PLANNING_CONSULT_WARNING: string;
export declare const PROMETHEUS_WORKFLOW_REMINDER: string;
