#!/usr/bin/env bun
import { z } from "zod"

const repository = "code-yeongyu/oh-my-openagent"
const stableTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const releaseSchema = z.object({
  tag_name: z.string(),
  body: z.string().nullable(),
  draft: z.boolean(),
  prerelease: z.boolean(),
})
const messageSchema = z.object({ id: z.string().regex(/^\d+$/) })
type Fetch = (url: string, init?: RequestInit) => Promise<Response>
type Options = {
  readonly tag: string
  readonly event: "release" | "workflow_dispatch"
  readonly webhook: string | undefined
  readonly token?: string
  readonly dryRun: boolean
  readonly probe: boolean
}

class AnnouncementError extends Error {}

export function composeMessage(tag: string, body: string | null): string {
  if (!body?.trim()) throw new AnnouncementError("Release body is empty")
  const paragraphs = body.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim().replace(/@(here|everyone)\b/gi, "$1"))
  const headlines = paragraphs.filter((paragraph) => /^\*\*.+?\*\*/s.test(paragraph))
  const opening = (headlines[0] ?? paragraphs[0]).replace(/\*\*/g, "").replace(/\s+/g, " ")
  const sentence = opening.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? opening
  const hook = sentence.length <= 300 ? sentence : "New fixes and improvements are ready to install."
  const blocks = [
    `## OmO ${tag.slice(1)}`,
    hook,
    "```sh\ncurl -fsSL https://get.omo.dev/install.sh | bash\n```\n```powershell\nirm https://get.omo.dev/install.ps1 | iex\n```",
  ]
  const footer = `The full notes are at <https://github.com/${repository}/releases/tag/${tag}>`
  for (const paragraph of headlines.slice(0, 4)) {
    if ([...blocks, paragraph, footer].join("\n\n").length >= 2000) break
    blocks.push(paragraph)
  }
  return [...blocks, footer].join("\n\n")
}

async function request(fetcher: Fetch, url: URL, method: string, body?: string, token?: string): Promise<Response> {
  try {
    return await fetcher(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    // Transport errors may contain the webhook token; never forward their text.
    throw new AnnouncementError(`${method} request failed`)
  }
}

export async function announce(options: Options, fetcher: Fetch = fetch, log: (line: string) => void = console.log) {
  if (!stableTag.test(options.tag)) {
    if (options.event === "release") return "skipped"
    throw new AnnouncementError("Tag must be a stable vX.Y.Z release")
  }
  if (!options.webhook?.trim()) throw new AnnouncementError("DISCORD_OMO_RELEASES_WEBHOOK_URL is missing")
  let webhook: URL
  try {
    webhook = new URL(options.webhook)
  } catch {
    throw new AnnouncementError("Webhook URL is invalid")
  }
  if (webhook.protocol !== "https:" || webhook.hostname !== "discord.com" ||
      !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[^/]+\/?$/.test(webhook.pathname)) {
    throw new AnnouncementError("Webhook URL is invalid")
  }
  const response = await request(fetcher, new URL(`https://api.github.com/repos/${repository}/releases/tags/${options.tag}`),
    "GET", undefined, options.token)
  if (!response.ok) throw new AnnouncementError(`GitHub release lookup returned HTTP ${response.status}`)
  let release: z.infer<typeof releaseSchema>
  try {
    release = releaseSchema.parse(await response.json())
  } catch {
    throw new AnnouncementError("GitHub returned invalid release metadata")
  }
  if (release.tag_name !== options.tag) throw new AnnouncementError("GitHub returned a different release tag")
  if (release.draft || release.prerelease) return "skipped"
  const content = composeMessage(options.tag, release.body)
  if (options.dryRun) {
    // Release notes are untrusted text, including possible Actions command syntax.
    const marker = crypto.randomUUID()
    log(`::stop-commands::${marker}`)
    log(content)
    log(`Length: ${content.length} characters`)
    log(`::${marker}::`)
    return "dry-run"
  }
  webhook.searchParams.set("wait", "true")
  const posted = await request(fetcher, webhook, "POST", JSON.stringify({
    content: options.probe
      ? `Release announcement pipeline check for ${options.tag}; this message deletes itself.`
      : content,
    allowed_mentions: { parse: [] },
  }))
  if (!posted.ok) throw new AnnouncementError(`Discord POST returned HTTP ${posted.status}`)
  let message: z.infer<typeof messageSchema>
  try {
    message = messageSchema.parse(await posted.json())
  } catch {
    throw new AnnouncementError("Discord POST did not return a created message")
  }
  if (!options.probe) return "posted"
  const messageUrl = new URL(webhook)
  messageUrl.pathname = `${webhook.pathname.replace(/\/$/, "")}/messages/${message.id}`
  messageUrl.searchParams.delete("wait")
  const deleted = await request(fetcher, messageUrl, "DELETE")
  if (!deleted.ok) throw new AnnouncementError(`Discord DELETE returned HTTP ${deleted.status}`)
  const verified = await request(fetcher, messageUrl, "GET")
  if (verified.status !== 404) throw new AnnouncementError(`Discord deletion verification returned HTTP ${verified.status}, expected 404`)
  return "probe"
}

function escapeCommand(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
}

if (import.meta.main) {
  const tag = process.env.RELEASE_TAG ?? ""
  const webhook = process.env.DISCORD_OMO_RELEASES_WEBHOOK_URL
  if (webhook) console.log(`::add-mask::${escapeCommand(webhook)}`)
  try {
    const event = process.env.GITHUB_EVENT_NAME
    if (event !== "release" && event !== "workflow_dispatch") throw new AnnouncementError("Unsupported workflow event")
    const result = await announce({
      tag, event, webhook, token: process.env.GH_TOKEN,
      dryRun: process.env.DRY_RUN === "true",
      probe: process.env.PROBE === "true",
    })
    console.log(`Release announcement ${escapeCommand(tag)}: ${result}`)
  } catch (error) {
    const reason = error instanceof AnnouncementError ? error.message : "Announcement failed"
    console.error(`::error::Release announcement ${escapeCommand(tag)}: ${reason}`)
    process.exitCode = 1
  }
}
