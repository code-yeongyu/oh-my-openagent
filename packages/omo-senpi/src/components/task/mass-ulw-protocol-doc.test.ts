import { describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import { join } from "node:path"

import { DAG_RUN_EVENT_TYPES } from "../../../../senpi-task/src/dag/types"
import { DAG_RPC_ERROR_CODES } from "./dag-rpc-handlers"

const repoRoot = join(import.meta.dir, "..", "..", "..", "..", "..")
const docPath = join(repoRoot, "docs", "reference", "mass-ulw-protocol.md")
const doc = fs.readFileSync(docPath, "utf8")

const bridgeSource = fs.readFileSync(join(import.meta.dir, "dag-rpc-bridge.ts"), "utf8")
const handlerSource = fs.readFileSync(join(import.meta.dir, "dag-rpc-handlers.ts"), "utf8")
const eventTypesSource = fs.readFileSync(join(repoRoot, "packages", "senpi-task", "src", "dag", "types.ts"), "utf8")

function extract(pattern: RegExp): readonly string[] {
  return [...new Set([...doc.matchAll(pattern)].map((match) => match[1] as string))]
}

describe("mass-ulw protocol doc", () => {
  describe("#given every backticked omo.dag.* name in the doc", () => {
    const wireNames = extract(/`(omo\.dag\.[a-z]+)`/g)

    describe("#when checked against the shipped bridge and handler sources", () => {
      it("#then each name exists as a string literal in the source", () => {
        expect(wireNames.length).toBeGreaterThan(0)
        for (const name of wireNames) {
          const shipped =
            bridgeSource.includes(`"${name}"`) || handlerSource.includes(`"${name}"`)
          expect(`${name}:${shipped}`).toBe(`${name}:true`)
        }
      })

      it("#then the doc covers all four channels and all four request methods", () => {
        for (const required of [
          "omo.dag.event",
          "omo.dag.heartbeat",
          "omo.dag.activity",
          "omo.dag.updated",
          "omo.dag.list",
          "omo.dag.snapshot",
          "omo.dag.history",
          "omo.dag.subscribe",
        ]) {
          expect(wireNames).toContain(required)
        }
      })
    })
  })

  describe("#given every backticked dag.* journaled event type in the doc", () => {
    const docTypes = extract(/`(dag\.[a-z]+\.[a-z-]+)`/g)

    describe("#when compared with DAG_RUN_EVENT_TYPES", () => {
      it("#then each doc type is a shipped type and every shipped type is documented", () => {
        const shippedTypes: readonly string[] = DAG_RUN_EVENT_TYPES
        for (const type of docTypes) {
          expect(shippedTypes).toContain(type)
        }
        for (const type of shippedTypes) {
          expect(docTypes).toContain(type)
        }
      })
    })
  })

  describe("#given the documented overflow payload fields", () => {
    describe("#when compared with the shipped event union", () => {
      it("#then the field names match exactly", () => {
        const sourceBlock = eventTypesSource.match(/readonly type: "dag\.stream\.overflow"([\s\S]*?)\n\s*}/)?.[1]
        const docBlock = doc.match(/\| `dag\.stream\.overflow` \|([^|]+)\|/)?.[1]
        if (sourceBlock === undefined || docBlock === undefined) throw new Error("overflow contract block missing")
        const sourceFields = [...sourceBlock.matchAll(/readonly ([A-Za-z]+):/g)].map((match) => match[1])
        const docFields = [...docBlock.matchAll(/`([A-Za-z]+)`/g)].map((match) => match[1])
        expect(docFields).toEqual(sourceFields)
      })
    })
  })

  describe("#given the documented error codes", () => {
    describe("#when compared with DAG_RPC_ERROR_CODES", () => {
      it("#then every shipped code appears in the doc", () => {
        for (const code of DAG_RPC_ERROR_CODES) {
          expect(doc).toContain(`\`${code}\``)
        }
      })
    })
  })
})
