# account-core — The omo Account Domain (Core)

## OVERVIEW

The one implementation of the omo account domain (#14943 design 3.1): the device session, the credential store, the device-code and browser sign-in flows, device keys and the device keyring. Package: `@oh-my-opencode/account-core`. Both editions' CLIs and the omo SDK reach the account through this package; it moved here unchanged from `packages/omo-opencode/src/cli/service-auth/` and `cli/account-keys/` (#14364, slice A1a).

## LAYOUT

| Path | Purpose |
|------|---------|
| `src/session.ts`, `src/owned-refresh.ts`, `src/refresh-attempt.ts`, `src/recovery-clock.ts` | The signed-in session: access snapshot, request, refresh under the credential lock, bounded recovery. |
| `src/keystore.ts`, `src/state-file-store.ts`, `src/linux-store-route.ts`, `src/secret-service-lock.ts`, `src/credential-lock.ts` | The credential store and its OS backends, with the cross-process credential lock. |
| `src/keychain-helper/` | The macOS keychain helper client: signature checks, the dedicated store, approval cache, recovery. |
| `src/device-flow.ts`, `src/loopback.ts`, `src/login-routes.ts`, `src/login-prelude.ts` | The device-code and browser sign-in flows. |
| `src/protocol.ts`, `src/protocol-request.ts`, `src/devices.ts`, `src/machine-*.ts` | The account service protocol, the device roster, this machine's device identity. |
| `src/keyring/` | This device's keyring: the signing and sealing keys and their store. |

## RULES

- No file here imports an edition package (`omo-opencode`, `omo-native`, `omo-senpi`, `omo-codex`) or any `cli/` path. The CLI adapters (`omo-opencode/src/cli/service-auth/commands.ts`, `cli/account-keys/commands.ts`) and the native launcher import this package; never the reverse. `script/remote-import-guard-rules.ts` enforces it.
- No secret is a field of a returned value, a failure, a log line or a child's argv or environment (security design #14945, section 6).
- Tests that drive the omo CLI binary live beside the CLI adapters, not here.

## QA

```bash
bun test --timeout 20000 packages/account-core/src/
bun run --cwd packages/account-core typecheck
```
