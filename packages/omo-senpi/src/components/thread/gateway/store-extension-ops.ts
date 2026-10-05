import { declarationProblem, declaredOpNames, importExtensionModule, persistDescriptor, readDescriptor, toolNameTaken } from "./extension-registrations"
import { assertExtensionName, checkExtensionSchema, ExtensionSchemaViolation, extensionSchema, extensionSql, sqliteName } from "./extension-sql"
import { ExtensionArgumentError, extensionTransaction } from "./extension-transaction"
import { singleExtensionStatement } from "./extension-statement"
import type { GatewayResolve } from "./engine"
import { isLockWaitExceeded } from "./lock-wait"
import { GatewaySchemaVersionError } from "./schema"
import { transaction, type StoreContext } from "./store-ops"
import type { StoreExtensionOperation, StoreExtensionRefusal, StoreExtensionRegistration, StoreExtensionResult } from "./store-extensions"

type Registered = {
  readonly descriptor: StoreExtensionRegistration
  readonly module: Readonly<Record<string, unknown>>
}

function refusal(code: StoreExtensionRefusal["code"], message: string): StoreExtensionRefusal {
  return { kind: "refused", code, message }
}

function fromError(error: unknown): StoreExtensionRefusal {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof ExtensionSchemaViolation || error instanceof GatewaySchemaVersionError || error instanceof ExtensionArgumentError) return refusal(error.code, message)
  if (isLockWaitExceeded(error)) return refusal("gateway_lock_wait_exceeded", message)
  return refusal("extension_operation_failed", message)
}

/** One op run in its own transaction: the args are built inside it, and `effects` run only after COMMIT. */
export type ExtensionRun = {
  readonly name: string
  readonly descriptor: Pick<StoreExtensionRegistration, "name" | "migrations">
  readonly module: Readonly<Record<string, unknown>>
  readonly op: string
  readonly args: () => unknown
  readonly effects?: readonly (() => void)[]
}

export class StoreExtensions {
  private readonly registered = new Map<string, Registered>()

  constructor(private readonly ctx: StoreContext, private readonly resolveTarget: GatewayResolve) {}

  /** `restoredAt`: a restarted worker replaying a registration this process made then (`persistDescriptor`). */
  async register(descriptor: StoreExtensionRegistration, now: number, restoredAt?: number): Promise<StoreExtensionResult<{ readonly version: number }>> {
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(descriptor.name) || !Array.isArray(descriptor.migrations)
      || !descriptor.migrations.every((step) => Array.isArray(step) && step.every((sql) => typeof sql === "string"))) {
      return refusal("invalid_arguments", "An extension needs a valid namespace and an array of SQL migration steps.")
    }
    const declared = declarationProblem(descriptor)
    if (declared !== undefined) return refusal("invalid_arguments", `Extension ${descriptor.name}: ${declared}.`)
    try {
      assertExtensionName(this.ctx.sql, descriptor.name)
    } catch (error) {
      return fromError(error)
    }
    let module: Readonly<Record<string, unknown>>
    try {
      module = await importExtensionModule(descriptor.moduleUrl)
    } catch (error) {
      return refusal("extension_import_failed", `Cannot import extension ${descriptor.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
    const exported = declarationProblem(descriptor, module)
    if (exported !== undefined) return refusal("invalid_arguments", `Extension ${descriptor.name}: ${exported}.`)
    // Checked before any migration runs, so a refused registration leaves the schema untouched;
    // persistDescriptor checks again inside its own transaction.
    const taken = toolNameTaken(this.ctx, descriptor)
    if (taken !== undefined) return refusal("invalid_arguments", `Extension ${descriptor.name}: ${taken}.`)
    try {
      const version = await this.ensure(descriptor, now)
      // The newest registration of a name replaces its persisted descriptor, so every process lists its session ops.
      const raced = await transaction(this.ctx, "extension_register", () => persistDescriptor(this.ctx, descriptor, now, restoredAt))
      if (raced !== undefined) return refusal("invalid_arguments", `Extension ${descriptor.name}: ${raced}.`)
      this.registered.set(descriptor.name, { descriptor, module })
      return { kind: "ok", value: { version } }
    } catch (error) {
      // Migration failures remain retryable on call; a downgrade must preserve the prior registration.
      if (!(error instanceof GatewaySchemaVersionError)) this.registered.set(descriptor.name, { descriptor, module })
      return fromError(error)
    }
  }

  /** Whether this exact registration is the one calls for its name now use. */
  holds(descriptor: StoreExtensionRegistration): boolean {
    return this.registered.get(descriptor.name)?.descriptor === descriptor
  }

  private async ensure(descriptor: Pick<StoreExtensionRegistration, "name" | "migrations">, now: number): Promise<number> {
    const { name, migrations } = descriptor
    for (;;) {
      const step = await transaction(this.ctx, "extension_migrate", () => {
        const row = this.ctx.sql.one(["version"], "SELECT version FROM extension_schema WHERE name = ?", [name])
        const version = Number(row?.version ?? 0)
        if (version > migrations.length) throw new GatewaySchemaVersionError(version, migrations.length, `Extension ${name}`)
        const before = extensionSchema(this.ctx.sql)
        if (row === undefined && before.objects.some((object) => sqliteName(String(object.name)).startsWith(`${name}_`) && before.owners.get(`${String(object.type)}:${sqliteName(String(object.name))}`) == null)) {
          throw new ExtensionSchemaViolation(`Namespace ${name} already contains unowned objects.`)
        }
        if (version === migrations.length) {
          if (row === undefined) this.ctx.sql.run("INSERT INTO extension_schema (name, version, updated_at) VALUES (?, 0, ?)", [name, now])
          return { version, applied: false }
        }
        for (const statement of migrations[version]) {
          singleExtensionStatement(statement)
          const beforeStatement = extensionSchema(this.ctx.sql)
          extensionSql(this.ctx.sql, name, () => this.ctx.sql.exec(statement))
          checkExtensionSchema(this.ctx.sql, name, beforeStatement, extensionSchema(this.ctx.sql))
        }
        checkExtensionSchema(this.ctx.sql, name, before, extensionSchema(this.ctx.sql))
        this.ctx.sql.run("INSERT INTO extension_schema (name, version, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at", [name, version + 1, now])
        return { version: version + 1, applied: true }
      })
      if (!step.applied) return step.version
    }
  }

  /** The public channel (connectors, the CLI, the SDK): a session-callable op is never reachable here, so no caller can be forged. */
  async call(name: string, op: string, args: unknown, now: number): Promise<StoreExtensionResult<unknown>> {
    const own = this.registered.get(name)
    const persisted = readDescriptor(this.ctx, name)
    if (declaredOpNames(own?.descriptor).has(op) || declaredOpNames(persisted).has(op)) {
      return refusal("caller_not_allowed", `${name}.${op} is session-callable: only the session's own tool reaches it, with the caller the engine resolved.`)
    }
    const entry = own ?? (await this.load(name, persisted))
    if ("kind" in entry) return entry
    return await this.run({ name, descriptor: entry.descriptor, module: entry.module, op, args: () => args }, now)
  }

  /**
   * An extension another process registered, from its persisted descriptor, with register()'s checks
   * (a file: .js/.mjs/.cjs URL, the namespace). Imported on each use, never cached as broken: a failed
   * import answers this call only, and the next one imports again.
   */
  async load(name: string, persisted = readDescriptor(this.ctx, name)): Promise<Registered | StoreExtensionRefusal> {
    if (persisted === undefined) return refusal("extension_unknown_name", `No store extension is registered as ${name}.`)
    try {
      assertExtensionName(this.ctx.sql, name)
    } catch (error) {
      return fromError(error)
    }
    try {
      return { descriptor: { ...persisted, name }, module: await importExtensionModule(persisted.moduleUrl) }
    } catch (error) {
      return refusal("extension_import_failed", `Cannot import extension ${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async run(request: ExtensionRun, now: number): Promise<StoreExtensionResult<unknown>> {
    const { name, op, module } = request
    const operation = Object.hasOwn(module, op) ? module[op] : undefined
    if (typeof operation !== "function") return refusal("extension_unknown_op", `Extension ${name} exports no operation ${op}.`)
    const effects: (() => void)[] = []
    const compensations: (() => void)[] = []
    let value: unknown
    try {
      await this.ensure(request.descriptor, now)
      value = await transaction(this.ctx, "extension_call", async () => {
        const before = extensionSchema(this.ctx.sql)
        const scope = extensionTransaction({ ...this.ctx, afterCommit: effects, afterRollback: compensations }, name, now, this.resolveTarget)
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          const run = async () => {
            try {
              return await (operation as StoreExtensionOperation)(scope.tx, request.args())
            } finally {
              await scope.finish()
            }
          }
          const deadline = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              scope.cancel()
              reject(new Error(`Extension ${name}.${op} exceeded its ${this.ctx.config.lock_wait_max_ms} ms operation budget.`))
            }, this.ctx.config.lock_wait_max_ms)
          })
          const result = await Promise.race([run(), deadline])
          checkExtensionSchema(this.ctx.sql, name, before, extensionSchema(this.ctx.sql))
          // Refuse uncloneable results before commit, not in the worker's response writer afterwards.
          const cloned = structuredClone(result)
          effects.push(...(request.effects ?? []))
          return cloned
        } finally {
          clearTimeout(timer)
          scope.cancel()
        }
      })
    } catch (error) {
      // The transaction rolled back: undo its early filesystem writes (a wake marker created before
      // the failing statement). A failed compensation only leaves a stale marker, which the next
      // reconcile removes with the row gone.
      for (const compensation of compensations) {
        try {
          compensation()
        } catch (compensationError) {
          this.ctx.emit({ kind: "extension_error", extension: name, phase: "after_rollback", error: compensationError instanceof Error ? compensationError.message : String(compensationError) })
        }
      }
      return fromError(error)
    }
    // Past COMMIT: a failure here never rolls back, so no compensation may run - exactly as a core
    // enqueue reports a post-commit failure without undoing its marker.
    await this.ctx.hook("afterDbCommit")
    for (const effect of effects) {
      try {
        effect()
      } catch (error) {
        this.ctx.emit({ kind: "extension_error", extension: name, phase: "after_commit", error: error instanceof Error ? error.message : String(error) })
      }
    }
    return { kind: "ok", value }
  }
}
