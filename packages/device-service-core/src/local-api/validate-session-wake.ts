// Vendored from sisyphuslabs/omo-relay-daemon@dab363aa3a9aa51936149d05b416310d429b61e0 packages/local-api/src/validate-session-wake.ts
import { requestFields, type RequestValidators } from "./validate-command.ts";
import { bool, exactly, fail } from "./validate-fields.ts";

// omo#13037 A7.2.1: the saved wake switch's two requests. `null` removes the stored value (the build default applies).
export const SESSION_WAKE_VALIDATORS: RequestValidators<
  "control.session_wake.get" | "control.session_wake.set"
> = {
  "control.session_wake.get": (v, id) => {
    requestFields(v, []);
    return { id, type: "control.session_wake.get" };
  },
  "control.session_wake.set": (v, id) => {
    const raw = requestFields(v, ["enabled"])["enabled"];
    return {
      id,
      type: "control.session_wake.set",
      enabled: raw === null ? null : bool(raw, "enabled"),
    };
  },
};

const storedOf = (v: unknown): boolean | null | "unreadable" =>
  v === null || v === "unreadable" || typeof v === "boolean" ? v : fail("stored");
export const sessionWakeState = (v: unknown) => {
  const m = exactly(v, ["enabled", "stored", "changedAt", "overridden"], [], "data");
  const stored = m["stored"];
  const changedAt = m["changedAt"];
  return {
    enabled: bool(m["enabled"], "enabled"),
    stored: storedOf(stored),
    changedAt: typeof changedAt === "string" ? changedAt : fail("changedAt"),
    overridden: bool(m["overridden"], "overridden"),
  };
};
