// These 7 rows need a /proc holder scan that can answer, and no Linux host can answer it today: the
// user's own LIVE `git` processes return EACCES on /proc/<pid>/fd (GitHub's ubuntu runners on the
// azure 7.0 kernel, sandbox boxes, desktops), even inside `unshare -Upf --mount-proc
// --map-current-user`. There the lock is kept, correctly, as possibly in use, so the rows skip on
// every Linux host, not only in one CI step (omo #10431). Coverage for them is macOS CI (and macOS
// hosts) until kernel-lock liveness lands (omo #10322), whose acceptance criterion is running them
// on Linux CI. OMO_CI_SAME_UID_GIT_UNINSPECTABLE=1 remains an alias for recipes that still set it.
export const SAME_UID_GIT_UNINSPECTABLE =
  process.platform === "linux" || process.env.OMO_CI_SAME_UID_GIT_UNINSPECTABLE === "1"
