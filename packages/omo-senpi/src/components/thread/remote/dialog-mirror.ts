import type { JsonObject } from "./ports"

/**
 * A secret input or a grant selection is answerable only on the connection that raised it: relayd refuses every other
 * answer to one (fail closed). A viewer that sees only the session's mirror is never shown one and never offered a way
 * to answer it, so no secret is typed into a terminal that cannot deliver it.
 */
export const raiserOnly = (request: JsonObject): boolean => request["secret"] === true || request["grantSelect"] === true
