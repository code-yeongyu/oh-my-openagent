# senpi installation component

## OVERVIEW

Installer and uninstaller for the Senpi plugin, local launcher, settings migration, and packaged-runtime artifact checks. The public barrel intentionally exposes the installer contract while helpers remain implementation seams.

## WHERE TO LOOK

| Path | Role |
|------|------|
| `install-senpi.ts` | `runSenpiInstaller` / `runSenpiUninstaller`, plugin registration, migration, and result contracts. |
| `local-launcher.ts` | Renders and installs the user-local launcher; product resolution re-enters through this boundary. |
| `senpi-settings.ts` | Validates, deduplicates, migrates, and atomically writes settings packages. |
| `plugin-artifacts.ts` | Required artifact inventory and provisioning checks for packaged runtime files. |
| `*.test.ts` | Installer, launcher, settings, refresh, and artifact behavior with filesystem fixtures. |

## CONVENTIONS

- Settings writes are atomic, and malformed settings fail with an explicit error rather than being silently replaced.
- Package lists are normalized and deduplicated; legacy builtin shadows and superseded packages are removed during migration.
- Installer and uninstaller return typed results so callers can report partial work without relying on process-global state.
- Artifact fixtures model both complete and missing runtime payloads. Keep required-artifact lists synchronized with the build payload.
- The local launcher is a compatibility boundary: foreign launchers are left untouched, while the Senpi-owned launcher can be installed or removed safely.

## ANTI-PATTERNS

- Do not overwrite a foreign launcher or rewrite settings in place without the atomic-write path.
- Do not accept non-object settings or non-string package entries, and do not preserve duplicate package names.
- Do not declare an artifact available merely because its parent directory exists; provisioning checks the required files.
- Keep installer behavior deterministic through the injected filesystem fixtures used by the tests.
