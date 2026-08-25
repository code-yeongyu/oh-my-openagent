// Test-only warm-up for senpi-task's lazy module boundaries.
//
// senpi-task reads the @earendil-works/pi-tui and @code-yeongyu/senpi namespaces lazily so the
// built omo-task.js/omo-member.js blobs do not statically bind those barrels (see
// src/senpi-static-import-guard.test.ts). Tests call the render helpers and runner values
// synchronously, so each test process warms both boundaries here before any test body runs.
// The root bunfig.toml does the same for repo-root `bun test` runs; this file covers package-local
// `bun test` invocations from inside packages/senpi-task and packages/omo-senpi.
const { loadPiTui } = await import("../src/lazy/pi-tui")
const { loadSenpiBarrel } = await import("../src/lazy/senpi-barrel")
await Promise.all([loadPiTui(), loadSenpiBarrel()])
