import { readFileSync } from "node:fs"
import { z } from "zod"
import type { Oracle } from "../vocabulary.ts"

/**
 * The report every conformance fixture writes, the same shape on every OS and toolkit. `fields` holds the
 * catalog oracle fields (live state of the window "Document"); `saved` holds that document's state at its
 * last File > Save plus how many windows were saved, the fields the task set's oracles read.
 */
const FIXTURE_REPORT_SCHEMA = "omo-conformance-fixture/1"

const catalogFields = z
  .object({
    value: z.string(),
    receivedKeys: z.string(),
    pressCount: z.number().int(),
    scrollSteps: z.number().int(),
    dragOrder: z.string(),
    menuSelection: z.string(),
  } satisfies Record<Oracle["field"], z.ZodType>)
  .strict()

const savedDocument = z
  .object({
    title: z.string(),
    name: z.string(),
    email: z.string(),
    city: z.string(),
    archived: z.boolean(),
    priority: z.string(),
    order: z.string(),
    doneRow: z.number().int(),
    note: z.string(),
    documentName: z.string(),
    items: z.string(),
    savedDocuments: z.number().int().nonnegative(),
  })
  .strict()

const rect = z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() }).strict()

/** Screen rects of the main window's widgets, keyed by accessible name (never a caption), logical points. */
const geometry = z
  .object({
    space: z.literal("screen-logical"),
    scale: z.number().positive(),
    window: z.object({ client: rect, frame: rect }).strict(),
    widgets: z.record(z.string(), z.object({ role: z.string().min(1), rect, hit: rect.optional() }).strict()),
  })
  .strict()
export type FixtureGeometry = z.infer<typeof geometry>

const fixtureReportSchema = z
  .object({
    schema: z.literal(FIXTURE_REPORT_SCHEMA),
    app: z.literal("Conformance Fixture"),
    toolkit: z.enum(["native", "electron", "webview"]),
    windows: z.array(z.string()),
    appKey: z.string().min(1),
    fields: catalogFields,
    saved: savedDocument,
    geometry: geometry.optional(),
  })
  .strict()
export type FixtureReport = z.infer<typeof fixtureReportSchema>

export function readFixtureReport(path: string): FixtureReport {
  return fixtureReportSchema.parse(JSON.parse(readFileSync(path, "utf8")))
}
