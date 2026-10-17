// Set only by the ubuntu CI step (.github/workflows/ci.yml). These 7 rows need a /proc holder scan
// that can answer, and no Linux host available to CI can answer it today: the user's own LIVE `git`
// processes return EACCES on /proc/<pid>/fd, on GitHub's ubuntu runners (azure 7.0 kernel) and on
// Boat alike, even inside `unshare -Upf --mount-proc --map-current-user`. There the lock is kept,
// correctly, as possibly in use. Coverage for these rows is macOS CI (and macOS hosts) until
// kernel-lock liveness lands (omo #10322), whose acceptance criterion is running them on Linux CI.
export const SAME_UID_GIT_UNINSPECTABLE = process.env.OMO_CI_SAME_UID_GIT_UNINSPECTABLE === "1"
