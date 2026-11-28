import {
  type AtomicCodeEntity,
  type AtomicCodeMatches,
  type AtomicGraphNode,
  type AtomicNeighbors,
  AtomicQueryCodeSchema,
  AtomicQueryEntitiesSchema,
  AtomicQueryNeighborsSchema,
  AtomicQuerySearchSchema,
  parseJsonContract,
} from "./contracts"
import { type AtomicCallOptions, type AtomicRunner, requireRepositoryRelativePath } from "./client-runner"

const READ = { sideEffectsPossible: false }

export type AtomicQueryOperations = {
  querySearch(call: AtomicCallOptions & { readonly query: string; readonly limit?: number }): Promise<readonly AtomicGraphNode[]>
  queryCode(call: AtomicCallOptions & { readonly pattern: string; readonly limit?: number }): Promise<AtomicCodeMatches>
  queryEntities(call: AtomicCallOptions & { readonly filePath: string }): Promise<readonly AtomicCodeEntity[]>
  queryNeighbors(call: AtomicCallOptions & { readonly nodeId: string; readonly depth?: 1 | 2 }): Promise<AtomicNeighbors>
}

export function createQueryOperations(run: AtomicRunner): AtomicQueryOperations {
  return {
    async querySearch(call) {
      const limit = call.limit === undefined ? [] : [`--limit=${call.limit}`]
      const args = ["query", "search", "--json", ...limit, "--", call.query]
      const stdout = await run({ operation: "query search", args, mutation: false }, call)
      return parseJsonContract(AtomicQuerySearchSchema, stdout, { operation: "query search", ...READ })
    },
    async queryCode(call) {
      const limit = call.limit === undefined ? [] : [`--max-results=${call.limit}`]
      const args = ["query", "code", "--json", ...limit, "--", call.pattern]
      const stdout = await run({ operation: "query code", args, mutation: false }, call)
      return parseJsonContract(AtomicQueryCodeSchema, stdout, { operation: "query code", ...READ })
    },
    async queryEntities(call) {
      const filePath = requireRepositoryRelativePath(call.filePath, "query entities")
      const args = ["query", "entities", "--json", "--", filePath]
      const stdout = await run({ operation: "query entities", args, mutation: false }, call)
      return parseJsonContract(AtomicQueryEntitiesSchema, stdout, { operation: "query entities", ...READ })
    },
    async queryNeighbors(call) {
      const depth = call.depth === undefined ? [] : [`--depth=${call.depth}`]
      const args = ["query", "neighbors", "--json", ...depth, "--", call.nodeId]
      const stdout = await run({ operation: "query neighbors", args, mutation: false }, call)
      return parseJsonContract(AtomicQueryNeighborsSchema, stdout, { operation: "query neighbors", ...READ })
    },
  }
}
