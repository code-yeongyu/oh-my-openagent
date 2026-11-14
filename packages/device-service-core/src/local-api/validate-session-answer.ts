// Vendored from sisyphuslabs/omo-relay-daemon@5bcdcc296c16a4c9af6f0618d5995e1e7ca0354e packages/local-api/src/validate-session-answer.ts
import type { IncompleteDevice, SessionCandidate, SessionCommandAnswer } from "./protocol.ts";
import { formatSessionRef, parseSessionRef } from "./session-ref.ts";
import { commandId, fail, type Fields, known, oneOf } from "./validate-fields.ts";
import { ALIAS_INCOMPLETE_REASONS, type ErrorCode } from "./vocabulary.ts";

// #393 part B (design C2): a {session} or {alias} answer names the device, the bare key and the session id beside its
// command_id, all three or none; the id must be the one the device and key form. session_ambiguous names its
// candidates the same way, and an alias's session_not_found names the devices whose listing was not complete.
export const refOf = (v: unknown, what: string): SessionCandidate => {
  const m = known(v, ["device", "key", "session"], [], what);
  const ref = parseSessionRef(m["session"]);
  if (ref === undefined || ref.device !== m["device"] || ref.key !== m["key"]) return fail(what);
  return { device: ref.device, key: ref.key, session: formatSessionRef(ref) };
};
export const commandAnswerOf = (v: unknown): SessionCommandAnswer => {
  const m = known(v, ["command_id"], ["device", "key", "session"], "session.command data");
  const command_id = commandId(m["command_id"]);
  if (m["device"] === undefined && m["key"] === undefined && m["session"] === undefined)
    return { command_id };
  const { device, key, session } = m;
  return { command_id, ...refOf({ device, key, session }, "session.command data") };
};
const listOf = <T>(v: unknown, item: (x: unknown) => T, what: string): readonly T[] =>
  Array.isArray(v) ? v.map(item) : fail(what);
const incompleteOf = (v: unknown): IncompleteDevice => {
  const m = known(v, ["device", "reason"], [], "error.incomplete");
  const device = m["device"];
  if (typeof device !== "string" || device.length === 0) return fail("error.incomplete");
  return { device, reason: oneOf(ALIAS_INCOMPLETE_REASONS, m["reason"], "error.incomplete") };
};
/** The optional alias fields of an error body: candidates on session_ambiguous only, incomplete on session_not_found only. */
export const aliasErrorFields = (
  code: ErrorCode,
  m: Fields,
): {
  readonly candidates?: readonly SessionCandidate[];
  readonly incomplete?: readonly IncompleteDevice[];
} => {
  const { candidates, incomplete } = m;
  if ((candidates !== undefined) !== (code === "session_ambiguous"))
    return fail("error.candidates");
  if (incomplete !== undefined && code !== "session_not_found") return fail("error.incomplete");
  return {
    ...(candidates === undefined
      ? {}
      : {
          candidates: listOf(candidates, (c) => refOf(c, "error.candidates"), "error.candidates"),
        }),
    ...(incomplete === undefined
      ? {}
      : { incomplete: listOf(incomplete, incompleteOf, "error.incomplete") }),
  };
};
