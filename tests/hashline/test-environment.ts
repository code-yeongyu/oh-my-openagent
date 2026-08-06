import { z } from "zod"

export type HashlineTestEnvironment = Readonly<{
  baseURL: string
  apiKey: string
}>

const hashlineTestEnvironmentSchema = z.object({
  HASHLINE_TEST_BASE_URL: z.string().min(1).url().refine(
    (value) => {
      const protocol = new URL(value).protocol
      return protocol === "http:" || protocol === "https:"
    },
    { message: "must use HTTP or HTTPS" },
  ),
  HASHLINE_TEST_API_KEY: z.string().min(1).refine((value) => value.trim().length > 0, {
    message: "must not be blank",
  }),
})

export function parseHashlineTestEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): HashlineTestEnvironment {
  const parsed = hashlineTestEnvironmentSchema.parse(environment)
  return {
    baseURL: parsed.HASHLINE_TEST_BASE_URL,
    apiKey: parsed.HASHLINE_TEST_API_KEY,
  }
}
