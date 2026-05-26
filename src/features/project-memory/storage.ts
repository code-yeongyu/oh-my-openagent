import * as fs from "node:fs"
import * as path from "node:path"
import { getFactsDir, getMemoryRoot, getProposalsDir } from "./constants"

export function isProjectMemoryEnabled(directory: string): boolean {
  return fs.existsSync(getMemoryRoot(directory))
}

export function readAllFacts(directory: string): { name: string; content: string }[] {
  const factsDir = getFactsDir(directory)
  if (!fs.existsSync(factsDir)) return []

  const files = fs.readdirSync(factsDir).filter((f) => f.endsWith(".md")).sort()
  return files.map((file) => ({
    name: file.replace(/\.md$/, ""),
    content: fs.readFileSync(path.join(factsDir, file), "utf-8"),
  }))
}

export function readFact(directory: string, name: string): string | null {
  const filePath = path.join(getFactsDir(directory), `${name}.md`)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, "utf-8")
}

export function getFactStats(directory: string): { files: number; totalLines: number } {
  const facts = readAllFacts(directory)
  const totalLines = facts.reduce((sum, f) => sum + f.content.split("\n").length, 0)
  return { files: facts.length, totalLines }
}

export interface Proposal {
  id: string
  file: string
  content: string
  reason: string
  action: "append" | "create"
  timestamp: string
}

export function listProposals(directory: string): Proposal[] {
  const proposalsDir = getProposalsDir(directory)
  if (!fs.existsSync(proposalsDir)) return []

  const files = fs.readdirSync(proposalsDir).filter((f) => f.endsWith(".json")).sort()
  return files.map((file) => {
    const raw = fs.readFileSync(path.join(proposalsDir, file), "utf-8")
    return JSON.parse(raw) as Proposal
  })
}

export function proposeFact(
  directory: string,
  args: { file: string; content: string; reason: string; action?: "append" | "create" },
): Proposal {
  const proposalsDir = getProposalsDir(directory)
  fs.mkdirSync(proposalsDir, { recursive: true })

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const proposal: Proposal = {
    id,
    file: args.file,
    content: args.content,
    reason: args.reason,
    action: args.action ?? "append",
    timestamp: new Date().toISOString(),
  }

  const filePath = path.join(proposalsDir, `${id}.json`)
  fs.writeFileSync(filePath, JSON.stringify(proposal, null, 2), "utf-8")
  return proposal
}

export function approveProposal(directory: string, proposalId: string): { ok: boolean; error?: string } {
  const proposalsDir = getProposalsDir(directory)
  const proposalPath = path.join(proposalsDir, `${proposalId}.json`)

  if (!fs.existsSync(proposalPath)) {
    return { ok: false, error: `Proposal ${proposalId} not found` }
  }

  const proposal = JSON.parse(fs.readFileSync(proposalPath, "utf-8")) as Proposal
  const factsDir = getFactsDir(directory)
  fs.mkdirSync(factsDir, { recursive: true })

  const targetPath = path.join(factsDir, `${proposal.file}.md`)

  if (proposal.action === "create") {
    if (fs.existsSync(targetPath)) {
      return { ok: false, error: `Facts file '${proposal.file}.md' already exists. Use append.` }
    }
    fs.writeFileSync(targetPath, proposal.content + "\n", "utf-8")
  } else {
    const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf-8") : ""
    const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : ""
    fs.writeFileSync(targetPath, existing + separator + proposal.content + "\n", "utf-8")
  }

  fs.unlinkSync(proposalPath)
  return { ok: true }
}

export function rejectProposal(directory: string, proposalId: string): { ok: boolean; error?: string } {
  const proposalsDir = getProposalsDir(directory)
  const proposalPath = path.join(proposalsDir, `${proposalId}.json`)

  if (!fs.existsSync(proposalPath)) {
    return { ok: false, error: `Proposal ${proposalId} not found` }
  }

  fs.unlinkSync(proposalPath)
  return { ok: true }
}
