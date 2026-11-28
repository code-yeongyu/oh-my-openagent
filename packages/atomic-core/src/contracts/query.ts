import * as z from "zod"

const GraphNodeSchema = z.object({
  id: z.string(),
  types: z.array(z.string()),
  label: z.string(),
  summary: z.string().optional(),
  source: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const AtomicQuerySearchSchema = z.array(GraphNodeSchema)

export const AtomicQueryCodeSchema = z.object({
  matches: z.array(
    z.object({
      path: z.string(),
      line_number: z.number(),
      line_content: z.string(),
      byte_offset: z.number(),
      submatch_start: z.number(),
      submatch_end: z.number(),
    }),
  ),
  total_matches: z.number(),
  dir_facets: z.array(z.tuple([z.string(), z.number()])),
})

export const AtomicQueryEntitiesSchema = z.array(
  z.object({
    name: z.string(),
    kind: z.string(),
    file: z.string(),
    line: z.number(),
    end_line: z.number(),
    column: z.number(),
    signature: z.string(),
    exported: z.boolean(),
  }),
)

export const AtomicQueryNeighborsSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(z.object({ from_id: z.string(), to_id: z.string(), kind: z.string() })),
})

export type AtomicGraphNode = z.infer<typeof GraphNodeSchema>
export type AtomicCodeMatches = z.infer<typeof AtomicQueryCodeSchema>
export type AtomicCodeEntity = z.infer<typeof AtomicQueryEntitiesSchema>[number]
export type AtomicNeighbors = z.infer<typeof AtomicQueryNeighborsSchema>
