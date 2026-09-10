# lifecycle - Residency, Reconciliation, and Cleanup

## OVERVIEW
Coordinates child admission, shutdown suspension, cross-session reconciliation, revival, destruction, and two-phase TTL cleanup.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Composition and ports | `create.ts`, `index.ts`, `port.ts`, `context.ts` | Public lifecycle factory and injected teardown seams. |
| Admission/residency | `admission-lease.ts`, `residency.ts` | Capacity claims, owner leases, and resident handles. |
| Session recovery | `reconcile.ts`, `reconcile-revival.ts`, `reconcile-reclamation.ts` | Scoped revival versus orphan reclamation. |
| Shutdown/destruction | `shutdown.ts`, `destroy.ts`, `revive-detached.ts` | Suspend or route deliberate stops through the destruction port. |
| Retention | `ttl.ts` | Tombstone under lock, artifact deletion outside lock. |

## CONVENTIONS
- Results use typed `ok`/`kind` outcomes; bounded capacity and lock contention defer rather than throw.
- Admission is batched under a renewable owner-token lease; respawn I/O occurs after releasing the critical section.
- In-process suspension is `persisted_only`; process suspension is `rpc_detached` and retains the last pid for orphan detection.
- Revival must use persisted safe spawn facts and the exact live provider/model identity; no substitute model is selected.

## ANTI-PATTERNS
- Lifecycle is the sole invoker of resident `abort`, `dispose`, `terminate`, or process signaling. Preserve the single-writer audit.
- Never delete a non-terminal record, live resident, pending notification, or unproven lost process during TTL cleanup.
- Never delete-then-create an admission lease; takeover is token-checked and atomic.
- Never await a live child during reconciliation; hand it back to the normal scheduler/settlement path.

## HOTSPOTS
- `residency.ts` (286 lines), `reconcile-reclamation.ts` (273), and `reconcile.ts` (265) carry the capacity and ownership decisions.
- `admission-lease.ts` (206) implements lease acquisition, renewal, takeover, and release.
- Race behavior is proven by spawned worker fixtures under `__fixtures__/`; keep those deterministic.

## QA
```sh
bun test packages/senpi-task/src/lifecycle
```

Parent: [`../AGENTS.md`](../AGENTS.md).
