// Sidecar entry for the one-shot legacy `gateway` -> `dori` config rename, bundled as extensions/omo-dori-migration.js
// and imported through `#omo-dori-migration-runtime` only when a config still has the old section
// (see ./dori-migration-loader.ts).

export { doriSectionRename } from "@oh-my-opencode/omo-opencode/config-migration/dori-section-rename"
