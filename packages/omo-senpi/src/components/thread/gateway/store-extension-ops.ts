import { extname } from "node:path"

import { assertExtensionName, checkExtensionSchema, ExtensionSchemaViolation, extensionSchema, extensionSql, sqliteName } from "./extension-sql"
import { extensionTransaction } from "./extension-transaction"
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
  if (error instanceof ExtensionSchemaViolation || error instanceof GatewaySchemaVersionError) return refusal(error.code, message)
  if (isLockWaitExceeded(error)) return refusal("gateway_lock_wait_exceeded", message)
  return refusal("extension_operation_failed", message)
}

export class StoreExtensions {
  private readonly registered = new Map<string, Registered>()

  constructor(private readonly ctx: StoreContext, private readonly resolveTarget: GatewayResolve) {}

  async register(descriptor: StoreExtensionRegistration, now: number): Promise<StoreExtensionResult<{ readonly version: number }>> {
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(descriptor.name) || !Array.isArray(descriptor.migrations)
      || !descriptor.migrations.every((step) => Array.isArray(step) && step.every((sql) => typeof sql === "string"))) {
      return refusal("invalid_arguments", "An extension needs a valid namespace and an array of SQL migration steps.")
    }
    try {
      assertExtensionName(this.ctx.sql, descriptor.name)
    } catch (error) {
      return fromError(error)
    }
    let module: Readonly<Record<string, unknown>>
    try {
      const url = new URL(descriptor.moduleUrl)
      if (url.protocol !== "file:" || ![".js", ".mjs", ".cjs"].includes(extname(url.pathname))) {
        return refusal("extension_import_failed", "moduleUrl must name a compiled JavaScript file URL.")
      }
      module = await import(descriptor.moduleUrl)
    } catch (error) {
      return refusal("extension_import_failed", `Cannot import extension ${descriptor.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      const version = await this.ensure(descriptor, now)
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

  private async ensure(descriptor: StoreExtensionRegistration, now: number): Promise<number> {
    const { name, migrations } = descriptor
    // Like core `migrate`, a current extension costs no write lock: read its version lock-free and
    // take the lock only when a step is pending or the version is unknown.
    const current = this.ctx.sql.one(["version"], "SELECT version FROM extension_schema WHERE name = ?", [name])
    if (current !== undefined && Number(current.version) === migrations.length) return migrations.length
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

  async call(name: string, op: string, args: unknown, now: number): Promise<StoreExtensionResult<unknown>> {
    const entry = this.registered.get(name)
    if (entry === undefined) return refusal("extension_unknown_name", `No store extension is registered as ${name}.`)
    const operation = Object.hasOwn(entry.module, op) ? entry.module[op] : undefined
    if (typeof operation !== "function") return refusal("extension_unknown_op", `Extension ${name} exports no operation ${op}.`)
    const effects: (() => void)[] = []
    const compensations: (() => void)[] = []
    let value: unknown
    try {
      const version = await this.ensure(entry.descriptor, now)
      value = await transaction(this.ctx, "extension_call", async () => {
        // Re-check under the call's own lock: a newer binary may have migrated the extension since.
        const row = this.ctx.sql.one(["version"], "SELECT version FROM extension_schema WHERE name = ?", [name])
        const locked = Number(row?.version ?? 0)
        if (locked !== version) throw new GatewaySchemaVersionError(locked, entry.descriptor.migrations.length, `Extension ${name}`)
        const before = extensionSchema(this.ctx.sql)
        const scope = extensionTransaction({ ...this.ctx, afterCommit: effects, afterRollback: compensations }, name, now, this.resolveTarget)
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          const run = async () => {
            try {
              return await (operation as StoreExtensionOperation)(scope.tx, args)
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
          return structuredClone(result)
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
