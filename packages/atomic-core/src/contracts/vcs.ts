import * as z from "zod"

const AuthorSchema = z.object({ name: z.string(), email: z.string() })

export const AtomicStatusSchema = z.object({
  schema_version: z.literal(1),
  repository_root: z.string(),
  view: z.string(),
  state: z.string(),
  clean: z.boolean(),
  needs_reindex: z.boolean(),
  stale_index_count: z.number(),
  entries: z.array(z.object({ path: z.string(), status: z.string(), code: z.string(), details: z.unknown() })),
})

export const AtomicLogSchema = z.array(
  z.object({
    sequence: z.number(),
    hash: z.string(),
    state: z.string(),
    message: z.string(),
    authors: z.array(AuthorSchema).optional(),
    timestamp: z.string(),
    is_tagged: z.boolean(),
  }),
)

export const AtomicChangeSchema = z.object({
  hash: z.string(),
  message: z.string(),
  authors: z.array(AuthorSchema).optional(),
  timestamp: z.string(),
  dependencies: z.array(z.string()),
  hunks: z.array(z.object({ hunk_type: z.string(), path: z.string() })),
  has_provenance: z.boolean(),
  provenance: z.looseObject({ session_id: z.string().nullable().optional() }).optional(),
  ledger: z.array(z.looseObject({ session_id: z.string(), agent_name: z.string(), changes_explained: z.array(z.string()) })).optional(),
})

const DiffLineSchema = z.object({
  status: z.string(),
  content: z.string(),
  old_line: z.number().nullable(),
  new_line: z.number().nullable(),
})

export const AtomicDiffSchema = z.object({
  schema_version: z.literal(1),
  view: z.string(),
  change: z.string().nullable(),
  files: z.array(
    z.object({
      path: z.string(),
      old_path: z.string().nullable(),
      new_path: z.string().nullable(),
      status: z.string(),
      code: z.string(),
      binary: z.boolean(),
      insertions: z.number(),
      deletions: z.number(),
      hunks: z.array(
        z.object({
          old_start: z.number(),
          old_count: z.number(),
          new_start: z.number(),
          new_count: z.number(),
          lines: z.array(DiffLineSchema),
        }),
      ),
    }),
  ),
  stats: z.object({ files: z.number(), insertions: z.number(), deletions: z.number() }),
})

export const AtomicViewListSchema = z.object({
  schema_version: z.literal(1),
  source: z.string(),
  repository_root: z.string(),
  remote: z.string().nullable(),
  current_view: z.string(),
  views: z.array(
    z.object({
      name: z.string(),
      current: z.boolean(),
      scope: z.string(),
      parent: z.string().nullable(),
      change_count: z.number(),
      own_change_count: z.number(),
      inherited_change_count: z.number(),
      state: z.string(),
      set_id: z.string().nullable(),
    }),
  ),
})

export type AtomicStatus = z.infer<typeof AtomicStatusSchema>
export type AtomicLogEntry = z.infer<typeof AtomicLogSchema>[number]
export type AtomicChange = z.infer<typeof AtomicChangeSchema>
export type AtomicDiff = z.infer<typeof AtomicDiffSchema>
export type AtomicViewList = z.infer<typeof AtomicViewListSchema>
