import { migrateLegacyPluginEntry as migrateLegacyPluginEntryImpl } from "../../shared/migrate-legacy-plugin-entry"

// An own forwarding function, not a re-export: auto-migrate.test.ts mocks this module, and a bun mock of a module that
// re-exports rebinds the function inside shared/migrate-legacy-plugin-entry itself, which leaked into later shared test
// files in the same process (#13331).
export const migrateLegacyPluginEntry: typeof migrateLegacyPluginEntryImpl = (...args) =>
  migrateLegacyPluginEntryImpl(...args)
