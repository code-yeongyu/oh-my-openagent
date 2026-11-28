import type { AtomicClient } from "./client"
import type { AtomicCallOptions } from "./client-runner"
import type { AtomicContextScope, AtomicContextService } from "./context"
import { AtomicError } from "./errors"
import { requireAtomicConformance, submitAtomicIntentReview } from "./intent-workflow"
import { atomicOperationInputs as inputs, parseAtomicOperationInput as parse } from "./operation-input"

type OperationsOptions = {
  readonly client: AtomicClient
  readonly context: Pick<AtomicContextService, "retrieve" | "invalidate">
  readonly sessionId: string
  readonly assignedIntentId?: string
}

type OperationCall = {
  readonly tool: string
  readonly input: unknown
  readonly scope: AtomicContextScope
  readonly signal?: AbortSignal
}

/** One instance per session. The adapter owns persistence of the assigned intent across restarts. */
export function createAtomicOperations(options: OperationsOptions) {
  const { client, context, sessionId } = options
  let assignedIntentId = options.assignedIntentId
  let mutationTail = Promise.resolve()

  function serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = mutationTail.then(action)
    mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  async function execute({ tool, input, scope, signal }: OperationCall) {
    const call: AtomicCallOptions = { cwd: scope.cwd, signal }
    async function mutate<T>(action: () => Promise<T>): Promise<T> {
      try {
        const value = await action()
        context.invalidate(scope.repository)
        return value
      } catch (error) {
        if (error instanceof AtomicError && error.sideEffectsPossible) context.invalidate(scope.repository)
        throw error
      }
    }

    switch (tool) {
      case "atomic_vcs": {
        const args = parse(tool, inputs.atomic_vcs, input)
        switch (args.operation) {
          case "status": return client.status(call)
          case "diff": return client.diff(call)
          case "log": return client.log({ ...call, limit: args.limit })
          case "change": return client.change({ ...call, hash: args.change_hash })
          default: { const unreachable: never = args; return unreachable }
        }
      }
      case "atomic_query": {
        const args = parse(tool, inputs.atomic_query, input)
        const { limit, operation } = args
        switch (operation) {
          case "search": return client.querySearch({ ...call, query: args.query, limit })
          case "code": return client.queryCode({ ...call, pattern: args.query, limit })
          case "entities": return (await client.queryEntities({ ...call, filePath: args.file_path })).slice(0, limit)
          case "neighbors": {
            const graph = await client.queryNeighbors({ ...call, nodeId: args.node_id })
            const nodes = graph.nodes.slice(0, limit)
            const returnedIds = new Set([args.node_id, ...nodes.map((node) => node.id)])
            return { nodes, edges: graph.edges.filter((edge) => returnedIds.has(edge.from_id) && returnedIds.has(edge.to_id)) }
          }
          default: { const unreachable: never = operation; return unreachable }
        }
      }
      case "atomic_context": {
        const args = parse(tool, inputs.atomic_context, input)
        return context.retrieve({
          scope, sessionId, signal, query: args.query, intentId: args.intent_id ?? assignedIntentId,
          files: args.files, limit: args.limit, budgetChars: args.budget_chars,
        })
      }
      case "atomic_sync":
        parse(tool, inputs.atomic_sync, input)
        return serialize(() => mutate(() => client.vaultSync(call)))
      case "atomic_intent": {
        const args = parse(tool, inputs.atomic_intent, input)
        const { operation } = args
        switch (operation) {
          case "list": return client.intentList(call)
          case "show": return client.intentShow({ ...call, id: args.intent_id })
          case "validate": return client.intentValidate({ ...call, id: args.intent_id })
          case "attest": return serialize(() => mutate(() => client.intentAttest({ ...call, id: args.intent_id })))
          case "new": return serialize(async () => {
            if (assignedIntentId !== undefined) {
              throw new AtomicError("ownership_mismatch", {
                operation: "intent new",
                sideEffectsPossible: false,
                message: `This session already has intent ${assignedIntentId}; reuse it.`,
              })
            }
            const intent = await mutate(() => client.intentNew({ ...call, title: args.title, kind: args.kind }))
            assignedIntentId = intent.id
            return intent
          })
          case "start": return serialize(async () => {
            const updated = await mutate(() => client.intentUpdateStatus({
              ...call, id: args.intent_id, status: "in_progress", sessionId,
            }))
            assignedIntentId = updated.id
            return updated
          })
          case "submit_review":
            return serialize(() => submitAtomicIntentReview(client, { ...call, id: args.intent_id }, mutate))
          default: { const unreachable: never = operation; return unreachable }
        }
      }
      case "atomic_memory": {
        const args = parse(tool, inputs.atomic_memory, input)
        return serialize(async () => {
          const memory = await mutate(() => client.memoryNew({
            ...call, kind: args.kind, text: args.text, derivedFrom: args.derived_from, about: args.about,
          }))
          const target = { ...call, id: memory.id }
          let stage: "attest" | "validate" = "attest"
          try {
            requireAtomicConformance(await mutate(() => client.memoryAttest(target)), "memory attest", true)
            stage = "validate"
            requireAtomicConformance(await client.memoryValidate(target), "memory validate", true)
            return { kind: "created" as const, memory }
          } catch (error) {
            if (!(error instanceof AtomicError)) throw error
            return { kind: "partial" as const, stage, memory, error }
          }
        })
      }
      default:
        throw new AtomicError("invalid_input", { operation: "semantic tool", sideEffectsPossible: false })
    }
  }

  return { execute, assignedIntent: () => assignedIntentId }
}
