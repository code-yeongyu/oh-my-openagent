export { registerPalaceCommand, runPalaceCommand } from "./command"
export type { PalaceCommandContext, PalaceCommandUi, PalaceContextResolver } from "./command"
export {
  HISTORY_MAX_COMMITS,
  HISTORY_PER_DIFF_CAP,
  HISTORY_RECENT_DIFFS,
  HISTORY_TOTAL_PAYLOAD_CAP,
  REFLECTION_COMMIT_PATTERN,
  UNCOMMITTED_LABEL,
  collectCore,
  collectExternal,
  collectHistory,
  collectReflection,
} from "./collectors"
export type {
  PalaceCommit,
  PalaceCoreEntry,
  PalaceEntryState,
  PalaceExternalEntry,
  PalaceHistory,
  PalaceHistoryCaps,
  PalaceReflection,
  PalaceReflectionOutcome,
} from "./collectors"
export { collectPalaceData, encodePalaceData, generatePalaceHtml, renderPalaceHtml } from "./generator"
export { PRIMARY_HUMAN_CARD_PATH, PRIMARY_HUMAN_SLUG, collectPeople } from "./people"
export type {
  PalacePeople,
  PalacePeopleDiagnostic,
  PalacePeopleEdge,
  PalacePeopleNode,
  PalacePeopleOptions,
} from "./people"
export type { GeneratePalaceOptions, GeneratePalaceResult, PalaceData, PalaceMetadata } from "./generator"
export {
  PALACE_DATA_ELEMENT_ID,
  PALACE_DATA_PLACEHOLDER,
  PALACE_PEOPLE_PANEL,
  PALACE_PEOPLE_TAB,
  PALACE_TEMPLATE,
} from "./template"
