// `git commit`/`git merge` end with `git maintenance run --auto --detach`, which can start a
// background gc (cruft pack + prune of loose objects) that races the next writer and readers
// outside every memory lock (omo #10177). Packing belongs to `maintain()` under the maintenance
// lock only, so every mutation on the memory commit/merge path carries these flags - including
// the reflection integration merge, which runs through the exec boundary directly.
export const NO_AUTO_MAINTENANCE = ["-c", "maintenance.auto=false", "-c", "gc.auto=0"] as const
