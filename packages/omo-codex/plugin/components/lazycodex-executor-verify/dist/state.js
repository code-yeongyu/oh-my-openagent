import { join } from "node:path";
export const MAX_ATTEMPTS = 3;
export function readAttemptState(cwd, sessionId, agentId, fs) {
    const statePath = getStatePath(cwd, sessionId, agentId);
    if (!fs.existsSync(statePath))
        return { attempts: 0 };
    try {
        const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
        if (isAttemptState(parsed))
            return parsed;
        return { attempts: 0 };
    }
    catch (error) {
        if (error instanceof SyntaxError || error instanceof Error)
            return { attempts: 0 };
        throw error;
    }
}
export function writeAttemptState(cwd, sessionId, agentId, state, fs) {
    const stateDir = getStateDir(cwd);
    const statePath = getStatePath(cwd, sessionId, agentId);
    const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(tempPath, `${JSON.stringify(state)}\n`);
    fs.renameSync(tempPath, statePath);
}
export function clearAttemptState(cwd, sessionId, agentId, fs) {
    fs.rmSync(getStatePath(cwd, sessionId, agentId), { force: true });
}
export function getStatePath(cwd, sessionId, agentId) {
    return join(getStateDir(cwd), `${sanitizeKey(sessionId)}-${sanitizeKey(agentId)}.json`);
}
function getStateDir(cwd) {
    return join(cwd, ".omo", "lazycodex-executor-verify");
}
function sanitizeKey(value) {
    const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return sanitized.length > 0 ? sanitized : "missing";
}
function isAttemptState(value) {
    return isRecord(value) && typeof value["attempts"] === "number" && Number.isInteger(value["attempts"]);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
