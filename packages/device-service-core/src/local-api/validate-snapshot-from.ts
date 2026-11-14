// Vendored from sisyphuslabs/omo-relay-daemon@4ed58920002306a95bf92fe99ca448be89d7103f packages/local-api/src/validate-snapshot-from.ts
import type { SnapshotBody } from "./protocol.ts";
import { bool, entryId, known } from "./validate-fields.ts";

// #896: the cursor echo on the first snapshot of an attach that sent `from`.
export const SNAPSHOT_OPTIONAL_FIELDS: readonly string[] = ["from"];
export const snapshotFromOf = (v: unknown): NonNullable<SnapshotBody["from"]> => {
  const m = known(v, ["last_entry_id", "delta"], [], "from");
  return {
    last_entry_id: entryId(m["last_entry_id"], "from.last_entry_id"),
    delta: bool(m["delta"], "from.delta"),
  };
};
