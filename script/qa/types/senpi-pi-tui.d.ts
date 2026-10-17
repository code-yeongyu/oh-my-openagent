// The audit fixture runs inside senpi, which serves `@earendil-works/pi-tui` from its own
// dependency. senpi re-exports the one pi-tui symbol the fixture uses, so the types come from
// senpi's public surface instead of a path into wherever senpi's dependencies are installed.
export { sanitizeTerminalLabel } from "@code-yeongyu/senpi"
