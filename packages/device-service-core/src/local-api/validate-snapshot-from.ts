// Vendored from sisyphuslabs/omo-relay-daemon@dab363aa3a9aa51936149d05b416310d429b61e0 packages/local-api/src/validate-snapshot-from.ts
import type { SnapshotBody } from "./protocol.ts";
import { bool, entryId, exactly } from "./validate-fields.ts";

// #896: the cursor echo on the first snapshot of an attach that sent `from`.
export const SNAPSHOT_OPTIONAL_FIELDS: readonly string[] = ["from"];
export const snapshotFromOf = (v: unknown): NonNullable<SnapshotBody["from"]> => {
  const m = exactly(v, ["last_entry_id", "delta"], [], "from");
  return {
    last_entry_id: entryId(m["last_entry_id"], "from.last_entry_id"),
    delta: bool(m["delta"], "from.delta"),
  };
};
