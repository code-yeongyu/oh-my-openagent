// Vendored from sisyphuslabs/omo-relay-daemon@dab363aa3a9aa51936149d05b416310d429b61e0 packages/local-api/src/validate-update.ts
import type { StatusUpdate, UpdateCommitted } from "./protocol-control.ts";
import {
  bool,
  exactly,
  localId,
  nullable,
  oneOf,
  semver,
  text,
  type Fields,
} from "./validate-fields.ts";
import { STATUS_UPDATE_PHASES } from "./vocabulary.ts";

// #829 P2 (design B.1): status.get's optional `update` (a candidate in trial) and owner.update_committed's request.
const READY_REASON_MAX_CHARS = 64;

export const statusUpdateOf = (v: unknown): StatusUpdate => {
  const m = exactly(
    v,
    ["update_id", "phase", "target_version", "ready", "ready_reason"],
    [],
    "status.update",
  );
  return {
    update_id: localId(m["update_id"], "status.update.update_id"),
    phase: oneOf(STATUS_UPDATE_PHASES, m["phase"], "status.update.phase"),
    target_version: semver(m["target_version"], "status.update.target_version"),
    ready: bool(m["ready"], "status.update.ready"),
    ready_reason: nullable(m["ready_reason"], (r) =>
      text(r, READY_REASON_MAX_CHARS, "status.update.ready_reason"),
    ),
  };
};

export const updateCommittedOf = (m: Fields, id: string): UpdateCommitted => ({
  id,
  type: "owner.update_committed",
  update_id: localId(m["update_id"], "update_id"),
});
