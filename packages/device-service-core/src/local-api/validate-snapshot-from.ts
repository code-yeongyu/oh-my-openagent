// Vendored from sisyphuslabs/omo-relay-daemon@42078b7cbfbc8db06cd626d99ab3b80017e7ae2a packages/local-api/src/validate-snapshot-from.ts
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
