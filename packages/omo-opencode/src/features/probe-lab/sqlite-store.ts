import { Database } from "bun:sqlite"
import { PROBE_LAB_SCHEMA } from "./schema"
import { applyProbeLabMigrations } from "./migrations"
import { getDefaultDbPath } from "./paths"
import { createHypothesisStore } from "./store/hypothesis-store"
import { createSessionStore } from "./store/session-store"
import { createExchangeStore } from "./store/exchange-store"
import { createEvidenceStore } from "./store/evidence-store"
import { createIdentityStore } from "./store/identity-store"
import { createQuestionStore } from "./store/question-store"
import { createExperimentStore } from "./store/experiment-store"
import { createProviderCredentialStore } from "./store/provider-credential-store"
import { createFingerprintProfileStore } from "./store/fingerprint-profile-store"
import { createRateLimitStore } from "./store/rate-limit-store"
import { createPoolSnapshotStore } from "./store/pool-snapshot-store"
import { createCanaryLockStore } from "./store/canary-lock-store"
import { createCaptureStore } from "./store/capture-store"
import { createAuditLogStore } from "./store/audit-log-store"
import { createSchemaMigrationsStore } from "./store/schema-migrations-store"
import { createProbeLabConfigStore } from "./store/probe-lab-config-store"
import { createMetricsStore } from "./store/metrics-store"
import { createAlertHistoryStore } from "./store/alert-history-store"

export type ProbeStore = ReturnType<typeof createProbeStore>

export function createProbeStore(dbPath: string = getDefaultDbPath()) {
  const db = new Database(dbPath)
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA foreign_keys = ON")
  db.run(PROBE_LAB_SCHEMA)
  applyProbeLabMigrations(db)

  const hypotheses = createHypothesisStore(db)
  const sessions = createSessionStore(db)
  const exchanges = createExchangeStore(db)
  const evidence = createEvidenceStore(db)
  const identities = createIdentityStore(db)
  const questions = createQuestionStore(db)
  const experiments = createExperimentStore(db)
  const providers = createProviderCredentialStore(db)
  const fingerprints = createFingerprintProfileStore(db)
  const rateLimits = createRateLimitStore(db)
  const snapshots = createPoolSnapshotStore(db)
  const canaries = createCanaryLockStore(db)
  const captures = createCaptureStore(db)
  const auditLog = createAuditLogStore(db)
  const migrations = createSchemaMigrationsStore(db)
  const config = createProbeLabConfigStore(db)
  const metrics = createMetricsStore(db)
  const alertHistory = createAlertHistoryStore(db)

  function close(): void {
    db.close()
  }

  function transaction<T>(fn: () => T): T {
    return db.transaction(fn)()
  }

  return {
    insertHypothesis: hypotheses.insert,
    getHypothesis: hypotheses.get,
    listHypotheses: hypotheses.list,
    updateHypothesisStatus: hypotheses.updateStatus,
    setHypothesisSupersededBy: hypotheses.setSupersededBy,
    setHypothesisResurrected: hypotheses.setResurrected,
    setHypothesisUncertaintyLabel: hypotheses.setUncertaintyLabel,
    insertSession: sessions.insert,
    getSession: sessions.get,
    findSessionByLabel: sessions.findByLabel,
    listSessionsForExperiment: sessions.listForExperiment,
    insertExchange: exchanges.insert,
    getExchange: exchanges.get,
    listExchangesForSession: exchanges.listForSession,
    countExchangesForSession: exchanges.countForSession,
    listExchangesForHypothesis: exchanges.listForHypothesis,
    countExchangesForHypothesis: exchanges.countForHypothesis,
    listExchangesByIds: exchanges.listByIds,
    insertEvidence: evidence.insert,
    setEvidenceKbEntry: evidence.setKbEntry,
    setEvidenceAspicExtensionsCount: evidence.setAspicExtensionsCount,
    listEvidenceForHypothesis: evidence.listForHypothesis,
    getLatestEvidenceForExchange: evidence.getLatestForExchange,
    upsertIdentity: identities.upsert,
    getIdentity: identities.get,
    findFirstActiveIdentity: identities.findFirstActive,
    promoteExpiredQuarantines: identities.promoteExpired,
    recordIdentityUse: identities.recordUse,
    setIdentityCircuitState: identities.setCircuitState,
    setIdentityTier: identities.setTier,
    promoteCanaryIdentities: identities.promoteCanaries,
    listIdentitiesByTier: identities.listByTier,
    countActiveHealthyCanaries: identities.countActiveHealthyCanaries,
    getPoolHealth: identities.getPoolHealth,
    setIdentityFingerprintProfileId: identities.setFingerprintProfileId,
    insertQuestion: questions.insert,
    getQuestion: questions.get,
    listQuestions: questions.list,
    updateQuestionStatus: questions.updateStatus,
    parkQuestion: questions.park,
    insertExperiment: experiments.insert,
    getExperiment: experiments.get,
    listExperiments: experiments.list,
    updateExperimentStatus: experiments.updateStatus,
    abortExperiment: experiments.abort,
    insertProvider: providers.insert,
    getProvider: providers.get,
    getProviderByName: providers.getByName,
    listProviders: providers.list,
    updateProviderStatus: providers.updateStatus,
    updateProviderAuthConfig: providers.updateAuthConfig,
    insertFingerprintProfile: fingerprints.insert,
    getFingerprintProfile: fingerprints.get,
    getFingerprintProfileByName: fingerprints.getByName,
    listFingerprintProfiles: fingerprints.list,
    updateFingerprintLastVerifiedAt: fingerprints.updateLastVerifiedAt,
    recordFingerprintDetectionScore: fingerprints.recordDetectionScore,
    insertRateLimitObservation: rateLimits.insert,
    listRateLimitsForIdentity: rateLimits.listForIdentity,
    listRateLimitsForProvider: rateLimits.listForProvider,
    deleteRateLimitsOlderThan: rateLimits.deleteOlderThan,
    countRateLimitsOlderThan: rateLimits.countOlderThan,
    insertPoolSnapshot: snapshots.insert,
    getPoolSnapshot: snapshots.get,
    listPoolSnapshotsForExperiment: snapshots.listForExperiment,
    insertCanaryLock: canaries.insert,
    getCanaryLock: canaries.get,
    getCanaryLockByIdentity: canaries.getByIdentity,
    releaseCanaryLock: canaries.release,
    recordCanaryResult: canaries.recordCanaryResult,
    listActiveCanaryLocks: canaries.listActive,
    insertCapture: captures.insert,
    getCapture: captures.get,
    listCapturesForSession: captures.listForSession,
    countCapturesOlderThan: captures.countOlderThan,
    deleteCapturesOlderThan: captures.deleteOlderThan,
    insertAuditLog: auditLog.insert,
    getAuditLog: auditLog.get,
    listAuditLog: auditLog.list,
    countAuditLog: auditLog.count,
    countAuditLogOlderThan: auditLog.countOlderThan,
    deleteAuditLogOlderThan: auditLog.deleteOlderThan,
    countExchangeBodiesOlderThan: exchanges.countResponseBodiesOlderThan,
    blankExchangeBodiesOlderThan: exchanges.blankResponseBodiesOlderThan,
    recordSchemaMigration: migrations.recordMigration,
    listSchemaMigrations: migrations.listApplied,
    isSchemaMigrationApplied: migrations.isApplied,
    getProbeLabConfig: config.get,
    setProbeLabConfig: config.set,
    listProbeLabConfig: config.list,
    deleteProbeLabConfig: config.delete,
    collectProbeMetrics: metrics.collect,
    recordAlertHistory: alertHistory.record,
    getAlertHistoryLastFiredAt: alertHistory.lastFiredAt,
    listAlertHistorySince: alertHistory.listSince,
    transaction,
    close,
  }
}
