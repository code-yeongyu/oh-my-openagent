import { z } from "zod"

export const PoolEntrySchema = z.object({
  ua: z.string().min(20),
  browser: z.enum(["chrome", "firefox", "safari", "edge"]),
  version: z.string().min(1),
  os: z.enum(["windows", "macos", "linux", "ios", "android"]),
  type: z.enum(["desktop", "mobile", "tablet"]),
})
export type PoolEntry = z.infer<typeof PoolEntrySchema>

export const PoolMetaSchema = z.object({
  generated: z.string(),
  chrome_stable: z.string().optional(),
  firefox_stable: z.string().optional(),
  safari_stable: z.string().optional(),
  edge_stable: z.string().optional(),
  source: z.string(),
  total: z.number().int().nonnegative(),
})
export type PoolMeta = z.infer<typeof PoolMetaSchema>

export const VendoredPoolSchema = z.object({
  meta: PoolMetaSchema,
  pool: z.array(PoolEntrySchema).min(40),
}).refine(
  (data) => !data.pool.some((entry) => /HeadlessChrome/i.test(entry.ua)),
  { message: "Pool must not contain HeadlessChrome UAs" },
)
export type VendoredPool = z.infer<typeof VendoredPoolSchema>

export function validateVendoredPool(raw: unknown): VendoredPool {
  return VendoredPoolSchema.parse(raw)
}
