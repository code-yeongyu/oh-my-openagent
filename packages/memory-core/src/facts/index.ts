export { loadFactsPersona } from "./assets/assets"
export {
  FactsQueue,
  type FactsEnqueueRequest,
  type FactsEnqueueResult,
  type FactsQueueOptions,
} from "./queue"
export {
  applyFactsBatch,
  FactsExtractionValidationError,
  parseFactsExtractionJsonl,
  validateFactsRecovery,
  type ApplyFactsBatchOptions,
  type ApplyFactsBatchResult,
  type FactsBatch,
  type FactsExtractionRecord,
  type FactsKnownPerson,
  type FactsPayload,
  type FactsPersonReference,
} from "./extraction"
export {
  FactsPlanParentDirtyError,
  factsRecordsHash,
  planFactsMutation,
  type FactsApplyRecovery,
  type FactsRecoveryPath,
} from "./mutation-plan"
export {
  applyFactsRecovery,
  findFactsBatchReceipt,
  type FactsRecoveryResult,
} from "./recovery"
export {
  normalizeObservationText,
  planFactsRouting,
  renderPersonTargets,
  type FactsAliasTie,
  type FactsPeopleRouting,
  type FactsPersonTarget,
  type FactsRoutingPlan,
} from "./person-routing"
export {
  FACTS_QUEUE_VERSION,
  canonicalPosition,
  factsQueuePaths,
  initialCursor,
  parseConsumed,
  parseCursor,
  parseQueueEntry,
  queueTimestamp,
  type FactsConsumedRecord,
  type FactsConsumedWatermark,
  type FactsCursor,
  type FactsQueueEntry,
  type FactsQueueLayout,
  type FactsQueueRange,
} from "./schema"
