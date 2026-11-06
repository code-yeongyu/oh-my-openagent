// Test-only: bind the vendored bunshin-ts SDK to the real @sinclair/typebox 0.34 before any test file runs.
//
// The first in-process extension load under Bun (createAgentSession with an extension, as senpi-task's
// senpi-api-tripwire test does) makes the senpi engine's bun-extension-registry call
// Bun.plugin({ setup: builder.module(name, ...) }) for every host module in its VIRTUAL_MODULES table. Those
// registrations are process-wide and cannot be removed, and "@sinclair/typebox" is one of the names, bound to
// typebox 1.x, which has no Type.Composite. vendor/bunshin-ts/index.js imports "@sinclair/typebox" by name and
// builds Type.Composite schemas at module top level, so every test file that first imports it after such a load
// fails to load ("Type6.Composite is not a function"). A tsconfig `paths` pin does not help: the plugin's virtual
// module wins over it. Production is not exposed: eval cells load plugin/runtime/bunshin-ts/sdk.js, which inlines
// typebox 0.34 and imports only node: builtins.
//
// Importing the vendored module here, ahead of every test file, caches it with its own 0.34 binding. The repo-root
// preload (test-setup.ts) and this package's bunfig.toml both load this file.
await import("../vendor/bunshin-ts/index.js")
