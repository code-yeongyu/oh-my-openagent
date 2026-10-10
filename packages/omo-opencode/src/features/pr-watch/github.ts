import { sharedGitHubReadTransport } from "./transport"
import { buildBatches, decodeBatch, parsePullRequest, type FingerprintBaseline, type FingerprintRow } from "./fingerprints.mjs"

export type PrCheck = { id: string; name: string; status: string; conclusion: string | null; required: boolean }
export type PrRemark = { id: string; author: string; updatedAt: string; url: string; kind: "comment" | "review" }
export type PrDetails = { state: string; mergeable: string; head: string; checks: PrCheck[] }
export type PrActivity = { remarks: PrRemark[] }

type RestRemark = { node_id: string; user?: { login: string }; updated_at: string; html_url: string }
type ReviewPage = { repository?: { pullRequest?: { reviews: { nodes: { id: string; author?: { login: string }; updatedAt: string; url: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } }
type RawCheck = { databaseId?: number; id: string; name?: string; context: string; status: string; state: string; conclusion: string | null; isRequired: boolean }
type QueryData = { repository?: { pullRequest?: {
  state: string; mergeable: string; headRefOid: string;
  commits?: { nodes: { commit: { statusCheckRollup?: { contexts: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawCheck[] } } } }[] };
} } }

function prQuery(reference: string, fields: string): string {
  const { owner, repo, number } = parsePullRequest(reference)
  return `query { rateLimit { remaining resetAt } repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(repo)}) { pullRequest(number:${number}) { ${fields} } } }`
}

export class GitHubPrWatchHost {
  constructor(readonly transport = sharedGitHubReadTransport()) {}

  async actor(): Promise<string> {
    const user = await this.transport.rest<{ login: string }>("/user")
    if (typeof user.login !== "string" || !user.login) throw new Error("Cannot identify authenticated GitHub actor")
    return user.login
  }

  async fingerprints(references: string[], previous: FingerprintBaseline, now: number): Promise<FingerprintRow[]> {
    const rows: FingerprintRow[] = []
    for (const batch of buildBatches(references)) {
      const response = await this.transport.graphql(batch.query)
      rows.push(...decodeBatch(batch, response, previous, now).rows)
    }
    return rows
  }

  async details(reference: string): Promise<PrDetails> {
    const { number } = parsePullRequest(reference)
    const checks: PrCheck[] = []
    const cursors = new Set<string>()
    let cursor: string | undefined
    let details: Omit<PrDetails, "checks"> | undefined
    do {
      const after = cursor === undefined ? "" : `,after:${JSON.stringify(cursor)}`
      const response = await this.transport.graphql<QueryData>(prQuery(reference, `state mergeable headRefOid commits(last:1) { nodes { commit { statusCheckRollup { contexts(first:100${after}) { pageInfo { hasNextPage endCursor } nodes {
        ... on CheckRun { databaseId name status conclusion isRequired(pullRequestNumber:${number}) }
        ... on StatusContext { id context state isRequired(pullRequestNumber:${number}) }
      } } } } } }`))
      if (response.errors?.length) throw new Error("GitHub PR detail query failed")
      const pr = response.data?.repository?.pullRequest
      if (!pr) throw new Error("GitHub PR detail missing")
      if (details && details.head !== pr.headRefOid) throw new Error("GitHub PR head changed during check pagination")
      details = { state: pr.state, mergeable: pr.mergeable, head: pr.headRefOid }
      const contexts = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts
      checks.push(...(contexts?.nodes ?? []).map((check: RawCheck): PrCheck => check.name
        ? { id: `run:${check.databaseId}`, name: check.name, status: check.status, conclusion: check.conclusion, required: check.isRequired }
        : { id: `status:${check.id}`, name: check.context, status: check.state === "PENDING" ? "IN_PROGRESS" : "COMPLETED", conclusion: check.state, required: check.isRequired }))
      if (!contexts?.pageInfo?.hasNextPage) break
      const next = contexts.pageInfo.endCursor
      if (!next || cursors.has(next)) throw new Error("GitHub check pagination did not advance")
      cursors.add(next)
      cursor = next
    } while (true)
    return { ...details!, checks: [...new Map(checks.map(check => [check.id, check])).values()] }
  }

  async activity(reference: string): Promise<PrActivity> {
    const { owner, repo, number } = parsePullRequest(reference)
    const prefix = `/repos/${owner}/${repo}`
    const remarks: PrRemark[] = []
    // REST review comments include every inline thread reply; no nested first:10 truncation.
    for (const [path, kind] of [
      [`${prefix}/issues/${number}/comments`, "comment"],
      [`${prefix}/pulls/${number}/comments`, "comment"],
    ] as const) {
      for (let page = 1; ; page++) {
        const rows = await this.transport.rest<RestRemark[]>(`${path}?per_page=100&page=${page}`)
        if (!Array.isArray(rows)) throw new Error("GitHub PR activity page missing")
        for (const row of rows) {
          const updatedAt = row.updated_at
          // An incomplete activity read must never become an acknowledged baseline.
          if (!row.node_id || !updatedAt || !row.html_url) throw new Error("GitHub PR activity row incomplete")
          remarks.push({ id: row.node_id, author: row.user?.login ?? "deleted-account", updatedAt, url: row.html_url, kind })
        }
        if (rows.length < 100) break
      }
    }
    // GraphQL exposes review edit timestamps that REST review rows do not contain.
    const cursors = new Set<string>()
    let cursor: string | undefined
    for (;;) {
      const after = cursor === undefined ? "" : `,after:${JSON.stringify(cursor)}`
      const response = await this.transport.graphql<ReviewPage>(prQuery(reference, `reviews(first:100${after}) { pageInfo { hasNextPage endCursor } nodes { id author { login } updatedAt url } }`))
      const reviews = response.data?.repository?.pullRequest?.reviews
      if (response.errors?.length || !reviews) throw new Error("GitHub PR review page missing")
      for (const row of reviews.nodes) {
        if (!row.id || !row.updatedAt || !row.url) throw new Error("GitHub PR review row incomplete")
        remarks.push({ id: row.id, author: row.author?.login ?? "deleted-account", updatedAt: row.updatedAt, url: row.url, kind: "review" })
      }
      if (!reviews.pageInfo.hasNextPage) break
      const next = reviews.pageInfo.endCursor
      if (!next || cursors.has(next)) throw new Error("GitHub review pagination did not advance")
      cursors.add(next)
      cursor = next
    }
    return { remarks: [...new Map(remarks.map(row => [row.id, row])).values()] }
  }
}
