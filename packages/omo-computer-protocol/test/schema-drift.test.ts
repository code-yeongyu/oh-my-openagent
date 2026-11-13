import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"

import { expect, test } from "vitest"

import { generatedPath, renderProtocolModule, schemaPath } from "../scripts/generate-protocol.ts"
import {
  ABI,
  ENV_SEAMS,
  METHODS,
  NOTIFICATIONS,
  PROTOCOL_VERSION,
  SCHEMA_SHA256,
  SETTINGS_TABLE,
} from "../src/index.ts"

// A missing schema reads as empty so the drift tests fail on their assertions, never on load.
const schemaText = existsSync(schemaPath) ? readFileSync(schemaPath, "utf8") : ""

test("the generated module was generated from the committed engine schema", () => {
  expect(createHash("sha256").update(schemaText).digest("hex")).toBe(SCHEMA_SHA256)
})

test("regenerating from the committed schema reproduces the committed module byte for byte", () => {
  expect(schemaText).not.toBe("")
  expect(renderProtocolModule(schemaText)).toBe(readFileSync(generatedPath, "utf8"))
})

test("the module carries the schema's handshake constants, method rows, notifications, seams and settings rows", () => {
  expect(schemaText).not.toBe("")
  const schema: {
    protocolVersion: string
    abi: string
    methods: Record<string, unknown>
    notifications: Record<string, unknown>
    envSeams: { name: string }[]
    settingsTable: { key: string; admissionKey: boolean }[]
  } = JSON.parse(schemaText)
  expect(PROTOCOL_VERSION).toBe(schema.protocolVersion)
  expect(ABI).toBe(schema.abi)
  expect(METHODS.map((row) => row.name)).toEqual(Object.keys(schema.methods))
  expect(NOTIFICATIONS).toEqual(Object.keys(schema.notifications))
  expect(ENV_SEAMS).toEqual(schema.envSeams.map((seam) => seam.name))
  expect(SETTINGS_TABLE.map((row) => [row.key, row.admissionKey])).toEqual(
    schema.settingsTable.map((row) => [row.key, row.admissionKey]),
  )
})
