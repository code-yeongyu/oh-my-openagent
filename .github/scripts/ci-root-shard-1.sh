#!/usr/bin/env bash
set -euo pipefail
# Linux root shard 1, split into two parallel parts (#14573). omo-opencode is never file-sharded: its global zauc mock
# bootstraps must load in the same process as their consumers (d2babd750c).
#
# memory-core: memory-core's stranded-git-lock tests read the host process table. On hosted runners same-uid processes
# of other sessions cannot be inspected, so memory-core runs in an unprivileged PID namespace, and the part fails loudly
# when no namespace can be made instead of falling back to the host table (omo #10199). Even inside it, the user's own
# LIVE git processes return EACCES on /proc/<pid>/fd (this runner's azure 7.0 kernel, and Boat alike), so the scans stay
# unanswerable here; the dead-writer reclaim rows pass through the kernel git-activity lock instead (omo #10322).
mode="${1:-}"
case "$mode" in
  omo-opencode)
    bun test --timeout 20000 packages/omo-opencode
    ;;
  memory-core)
    if [ -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
      sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
    fi
    if ! procs="$(unshare -Upf --mount-proc --map-current-user -- sh -c 'ls /proc | grep -c "^[0-9]"')"; then
      echo "::error::cannot create an unprivileged PID namespace; memory-core's lock tests must not fall back to the host process table (omo #10199)"
      exit 1
    fi
    if [ "$procs" -gt 8 ]; then
      echo "::error::the PID namespace sees $procs processes, so it is not isolated from the host (omo #10199)"
      exit 1
    fi
    echo "PID namespace ready ($procs processes visible)"
    unshare -Upf --mount-proc --map-current-user -- env CI=1 bun test --timeout 20000 packages/memory-core
    ;;
  *)
    printf '%s\n' "ci-root-shard-1.sh: expected omo-opencode or memory-core" >&2
    exit 2
    ;;
esac
