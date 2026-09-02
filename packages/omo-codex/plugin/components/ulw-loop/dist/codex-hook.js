import { parseUlwLoopSteeringDirective, steerUlwLoop } from "./steering.js";
import { buildUltraworkDirectiveOutput } from "./ultrawork-directive.js";
const CREATE_GOAL_TOOL_NAME = "create_goal";
const CREATE_GOAL_PAYLOAD_WARNING = "Use create_goal with objective only. Omit token_budget so the goal stays unlimited, and put lifecycle status changes on update_goal.";
export function parseUserPromptSubmitPayload(raw) {
    if (raw.trim().length === 0)
        return null;
    try {
        const parsed = JSON.parse(raw);
        return isUserPromptSubmitPayload(parsed) ? parsed : null;
    }
    catch (error) {
        if (error instanceof SyntaxError)
            return null;
        return null;
    }
}
export function parsePreToolUsePayload(raw) {
    if (raw.trim().length === 0)
        return null;
    try {
        const parsed = JSON.parse(raw);
        return isPreToolUsePayload(parsed) ? parsed : null;
    }
    catch (error) {
        if (error instanceof SyntaxError)
            return null;
        return null;
    }
}
export async function applyUserPromptUlwLoopSteering(payload, options = {}) {
    try {
        if (payload.hook_event_name !== "UserPromptSubmit")
            return "";
        const proposal = parseUlwLoopSteeringDirective(payload.prompt);
        if (proposal === null) {
            if (hasSteeringDirectiveMarker(payload.prompt))
                return "";
            if (!options.includeUltraworkDirective)
                return "";
            return options.ultraworkSkillFilePath === undefined
                ? buildUltraworkDirectiveOutput(payload)
                : buildUltraworkDirectiveOutput(payload, { skillFilePath: options.ultraworkSkillFilePath });
        }
        const result = await steerUlwLoop(payload.cwd, proposal, payloadScope(payload));
        if (!result.accepted)
            return "";
        return JSON.stringify({
            status: "accepted",
            kind: result.audit.kind,
            source: result.audit.source,
            deduped: result.deduped,
        });
    }
    catch (error) {
        if (error instanceof Error)
            return "";
        return "";
    }
}
function hasSteeringDirectiveMarker(prompt) {
    return /(?:^|\s)(?:OMO_ULW_LOOP_STEER|omo\.ulw-loop\.steer|omo ulw-loop steer|omo-agent-toolkit ulw-loop steer):/u.test(prompt);
}
function payloadScope(payload) {
    return { sessionId: payload.session_id };
}
export function applyPreToolUseGoalBudgetGuard(payload) {
    if (payload.hook_event_name !== "PreToolUse")
        return "";
    if (payload.tool_name !== CREATE_GOAL_TOOL_NAME)
        return "";
    if (!hasInvalidCreateGoalInput(payload.tool_input))
        return "";
    const output = {
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: CREATE_GOAL_PAYLOAD_WARNING,
            additionalContext: CREATE_GOAL_PAYLOAD_WARNING,
        },
    };
    return `${JSON.stringify(output)}\n`;
}
export async function runUlwLoopHookCli(stdin, stdout, options = {}) {
    try {
        const payload = parseUserPromptSubmitPayload(await readAll(stdin));
        if (payload === null)
            return;
        const output = await applyUserPromptUlwLoopSteering(payload, options);
        if (output.length > 0)
            stdout.write(output);
    }
    catch (error) {
        if (error instanceof Error)
            return;
        return;
    }
}
export async function runPreToolUseGoalBudgetGuardCli(stdin, stdout) {
    try {
        const payload = parsePreToolUsePayload(await readAll(stdin));
        if (payload === null)
            return;
        const output = applyPreToolUseGoalBudgetGuard(payload);
        if (output.length > 0)
            stdout.write(output);
    }
    catch (error) {
        if (error instanceof Error)
            return;
        return;
    }
}
function isUserPromptSubmitPayload(value) {
    if (!isRecord(value))
        return false;
    return (value["hook_event_name"] === "UserPromptSubmit" &&
        typeof value["cwd"] === "string" &&
        typeof value["prompt"] === "string" &&
        typeof value["session_id"] === "string" &&
        ["model", "permission_mode", "turn_id"].every((key) => optionalString(value[key])) &&
        (value["transcript_path"] === undefined ||
            value["transcript_path"] === null ||
            typeof value["transcript_path"] === "string"));
}
function isPreToolUsePayload(value) {
    if (!isRecord(value))
        return false;
    return (value["hook_event_name"] === "PreToolUse" &&
        typeof value["cwd"] === "string" &&
        typeof value["model"] === "string" &&
        typeof value["permission_mode"] === "string" &&
        typeof value["session_id"] === "string" &&
        typeof value["tool_name"] === "string" &&
        typeof value["tool_use_id"] === "string" &&
        (value["transcript_path"] === null || typeof value["transcript_path"] === "string") &&
        typeof value["turn_id"] === "string" &&
        Object.hasOwn(value, "tool_input"));
}
function hasInvalidCreateGoalInput(value) {
    return isRecord(value) && Object.keys(value).some((key) => key !== "objective");
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function optionalString(value) {
    return value === undefined || typeof value === "string";
}
function readAll(stdin) {
    return new Promise((resolve, reject) => {
        let data = "";
        stdin.setEncoding("utf8");
        stdin.on("data", (chunk) => {
            data += chunk instanceof Buffer ? chunk.toString() : String(chunk);
        });
        stdin.once("error", reject);
        stdin.once("end", () => resolve(data));
    });
}
