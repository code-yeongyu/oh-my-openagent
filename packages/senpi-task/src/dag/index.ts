// allow: SIZE_OK - dag subsystem public API barrel contains re-exports only, giving the harness
// adapter one stable import surface instead of deep per-module paths.
export type {
  DagActivityEvent,
  DagBottleneck,
  DagDiagnostic,
  DagEdge,
  DagEventLane,
  DagNode,
  DagNodeError,
  DagNodeErrorCode,
  DagNodeId,
  DagNodeState,
  DagNodeCounts,
  DagNodeTargetError,
  DagNodeTargetErrorCode,
  DagNodeTargetInput,
  DagNodeTransitionReason,
  DagRoute,
  DagRunEvent,
  DagRunEventEnvelope,
  DagRunEventPayload,
  DagRunId,
  DagRunSnapshot,
  DagRunStatus,
  DagSettings,
  DagWave,
} from "./types"
export {
  DAG_ACTIVITY_CHANNEL,
  DAG_EVENT_LANES,
  DAG_NODE_ERROR_CODES,
  DAG_NODE_STATES,
  DAG_NODE_TRANSITION_REASONS,
  DAG_ROUTE_KINDS,
  DAG_RUN_EVENT_TYPES,
  DAG_RUN_STATUSES,
  DAG_SETTINGS_DEFAULTS,
} from "./types"

export { compileDag, DAG_COMPILE_ERROR_CODES } from "./graph"
export type {
  DagCompileError,
  DagCompileErrorCode,
  DagCompileOptions,
  DagCompileResult,
  DagDefinition,
  DagNodeInput,
} from "./graph"

export { dagDefinitionFingerprint, dagFingerprint, nodeFingerprintInput } from "./fingerprint"
export type { DagDefinitionFingerprintInputV1, DagNodeFingerprintInputV1 } from "./fingerprint"

export {
  dagDefinitionAmendedEvent,
  dagDiagnosticAddedEvent,
  dagEventLane,
  dagNodeRetriedEvent,
  dagNodeReusedEvent,
  dagNodeSteeredEvent,
  dagNodeTaskAttachedEvent,
  dagNodeTransitionedEvent,
  dagRunCancelledEvent,
  dagRunCompletedEvent,
  dagRunCreatedEvent,
  dagRunFailedEvent,
  dagRunPausedEvent,
  dagRunResumedEvent,
  dagRunStartedEvent,
  dagStreamOverflowEvent,
  dagWaveCompletedEvent,
  dagWaveStartedEvent,
} from "./events"
export type { DagRunEventType } from "./events"

export { createDagFileStore, dagKeyHash, DagJournalCorruptError } from "./store"
export type {
  DagEventPage,
  DagEventReadOptions,
  DagFileStore,
  DagKeyRecord,
  DagStoreConfig,
  DagStoreDiagnostic,
  DagStorePaths,
} from "./store"

export { createDagJournal } from "./journal"
export type { DagJournal, DagJournalCheckpoint, DagJournalListener, DagJournalOptions } from "./journal"

// manager.ts and handle.ts both name a `DagRunHandle`. handle.ts's is the superset (it adds done()
// and cancel()), so it keeps the plain name and the manager's snapshot-only shape is aliased.
export { createDagManager, DAG_MANAGER_ERROR_CODES, DagManagerError } from "./manager"
export type {
  AmendRecord,
  DagHistoryParams,
  DagManager,
  DagManagerErrorCode,
  DagManagerOptions,
  DagMaterializeSkills,
  DagPersistedDefinition,
  DagPersistedNode,
  DagRunHandle as DagManagerRunHandle,
  DagRunRecordV1,
  DagRunSummary,
  DagSkillMaterialization,
  DagStartParams,
  DagStartResult,
} from "./manager"

export { createDagWaitSurface, DAG_WAIT_ERROR_CODES, DagWaitError } from "./handle"
export type {
  DagRunHandle,
  DagRunResult,
  DagTerminalNodeResult,
  DagWaitErrorCode,
  DagWaitSurface,
  DagWaitSurfaceOptions,
} from "./handle"

export type { DagTaskOwner, DagTaskOwnerKey, OwnedStartResult } from "./owner"

export { createDagRecovery } from "./recovery"
export type { DagRecovery, DagRecoveryOptions, DagRecoveryOutcome } from "./recovery"

export { resolveDagNodeExecutionMode } from "./execution-mode"
export type { DagExecutionModeSources } from "./execution-mode"

export { applyDagSchedulerEvent, createDagScheduler } from "./scheduler"
export type { DagNodeSpawnPolicy, DagNodeSpawnPolicyVerdict, DagScheduler, DagSchedulerOptions } from "./scheduler"

export { persistDagNodeResult, readDagNodeResult } from "./results"
export type {
  DagNodeResultArtifact,
  DagNodeResultPersistInput,
  DagNodeResultPersistOutcome,
  DagNodeResultRead,
  DagNodeResultReadInput,
  DagResultArtifactRef,
} from "./results"
