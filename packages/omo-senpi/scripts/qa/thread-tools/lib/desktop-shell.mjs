/**
 * Desktop shell data path for the UI-exposure scenarios.
 *
 * This builds the REAL orchestration stack the shellSnapshot HTTP route serves
 * (apps/server/src/orchestration/http.ts:48-64 answers from
 * `ProjectionSnapshotQuery.getShellSnapshot()`), on in-memory sqlite, using the same layer
 * recipe as the desktop's own OrchestrationEngine tests. Nothing about the projection is
 * stubbed: a row only appears here if the mirror really dispatched thread.create through
 * the engine and the projection pipeline really projected it.
 */
import { desktopDependency, desktopModule } from "./harness.mjs"

const D = "apps/server/src"

export async function startDesktopShell({ cwd, prefix }) {
  const Effect = await desktopDependency("effect/Effect")
  const Layer = await desktopDependency("effect/Layer")
  const ManagedRuntime = await desktopDependency("effect/ManagedRuntime")
  const NodeServices = await desktopDependency("@effect/platform-node/NodeServices")

  const { OrchestrationCommandReceiptRepositoryLive } = await desktopModule(
    `${D}/persistence/Layers/OrchestrationCommandReceipts.ts`,
  )
  const { OrchestrationEventStoreLive } = await desktopModule(`${D}/persistence/Layers/OrchestrationEventStore.ts`)
  const { SqlitePersistenceMemory } = await desktopModule(`${D}/persistence/Layers/Sqlite.ts`)
  const RepositoryIdentityResolver = await desktopModule(`${D}/project/RepositoryIdentityResolver.ts`)
  const { OrchestrationEngineLive } = await desktopModule(`${D}/orchestration/Layers/OrchestrationEngine.ts`)
  const { OrchestrationProjectionPipelineLive } = await desktopModule(`${D}/orchestration/Layers/ProjectionPipeline.ts`)
  const { OrchestrationProjectionSnapshotQueryLive } = await desktopModule(
    `${D}/orchestration/Layers/ProjectionSnapshotQuery.ts`,
  )
  const ThreadBackgroundLiveness = await desktopModule(`${D}/orchestration/ThreadBackgroundLiveness.ts`)
  const ThreadPlanProgress = await desktopModule(`${D}/orchestration/ThreadPlanProgress.ts`)
  const { OrchestrationEngineService } = await desktopModule(`${D}/orchestration/Services/OrchestrationEngine.ts`)
  const { ProjectionSnapshotQuery } = await desktopModule(`${D}/orchestration/Services/ProjectionSnapshotQuery.ts`)
  const { ServerConfig } = await desktopModule(`${D}/config.ts`)

  const layer = Layer.mergeAll(
    OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
    ),
    OrchestrationProjectionSnapshotQueryLive,
  ).pipe(
    Layer.provide(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provideMerge(ServerConfig.layerTest(cwd, { prefix })),
    Layer.provideMerge(NodeServices.layer),
  )
  const runtime = ManagedRuntime.make(layer)

  return {
    runtime,
    Effect,
    OrchestrationEngineService,
    ProjectionSnapshotQuery,
    /** The exact read the shellSnapshot route serves. */
    shellSnapshot: () =>
      runtime.runPromise(
        Effect.gen(function* () {
          const query = yield* Effect.service(ProjectionSnapshotQuery)
          return yield* query.getShellSnapshot()
        }),
      ),
    dispose: () => runtime.dispose(),
  }
}

/** Mirror modules, loaded once so scripts share one import of the derivations. */
export async function loadMirror() {
  return await desktopModule(`${D}/orchestration/OmoSessionMirror.ts`)
}
