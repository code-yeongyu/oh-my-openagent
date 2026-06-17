import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const REPO_ROOT = join(import.meta.dir, "..")
const AGENT_DIR = join(import.meta.dir, "agent")

function read(path: string): string {
  return readFileSync(path, "utf8")
}

function parsesAsJson(raw: string): boolean {
  try {
    JSON.parse(raw)
    return true
  } catch {
    return false
  }
}

describe("cross-harness env wiring", () => {
  test("#given Cursor cloud agents #when reading .cursor/environment.json #then install delegates to the shared setup script", () => {
    // given
    const path = join(REPO_ROOT, ".cursor", "environment.json")

    // when / then
    expect(existsSync(path), ".cursor/environment.json must exist").toBe(true)
    const raw = read(path)
    expect(parsesAsJson(raw), ".cursor/environment.json must be valid JSON").toBe(true)
    expect(raw).toContain("script/agent/setup.sh")
  })

  test("#given Claude Code #when reading .claude/settings.json #then SessionStart runs setup and SessionEnd runs cleanup", () => {
    // given
    const path = join(REPO_ROOT, ".claude", "settings.json")

    // when / then
    expect(existsSync(path), ".claude/settings.json must exist").toBe(true)
    const raw = read(path)
    expect(parsesAsJson(raw), ".claude/settings.json must be valid JSON").toBe(true)
    expect(raw).toContain("SessionStart")
    expect(raw).toContain("SessionEnd")
    expect(raw).toContain("script/agent/setup.sh")
    expect(raw).toContain("script/agent/cleanup.sh")
  })

  test("#given Codex App local environments #when reading .codex/setup.sh #then it delegates to the shared setup script", () => {
    // given
    const path = join(REPO_ROOT, ".codex", "setup.sh")

    // when / then
    expect(existsSync(path), ".codex/setup.sh must exist (committable Codex App setup)").toBe(true)
    const raw = read(path)
    expect(raw.startsWith("#!/usr/bin/env bash")).toBe(true)
    expect(raw).toContain("script/agent/setup.sh")
  })

  test("#given Codespaces + Dev Containers #when reading .devcontainer/devcontainer.json #then it builds the Dockerfile and runs setup on create", () => {
    // given
    const path = join(REPO_ROOT, ".devcontainer", "devcontainer.json")

    // when / then
    expect(existsSync(path), ".devcontainer/devcontainer.json must exist").toBe(true)
    const raw = read(path)
    expect(parsesAsJson(raw), "devcontainer.json must be strict JSON").toBe(true)
    expect(raw).toContain("postCreateCommand")
    expect(raw).toContain("script/agent/setup.sh")
    expect(raw).toContain("Dockerfile")
  })

  test("#given the devcontainer image #when reading .devcontainer/Dockerfile #then it pins node 24 + bun + tmux", () => {
    // given
    const path = join(REPO_ROOT, ".devcontainer", "Dockerfile")

    // when / then
    expect(existsSync(path), ".devcontainer/Dockerfile must exist").toBe(true)
    const raw = read(path)
    expect(raw).toContain("FROM mcr.microsoft.com/devcontainers/javascript-node")
    expect(raw).toContain("bun")
    expect(raw).toContain("tmux")
  })

  test("#given plain Docker users #when reading script/agent/docker-dev.sh #then it builds from the devcontainer Dockerfile", () => {
    // given
    const path = join(AGENT_DIR, "docker-dev.sh")

    // when / then
    expect(existsSync(path), "script/agent/docker-dev.sh must exist").toBe(true)
    const raw = read(path)
    expect(raw.startsWith("#!/usr/bin/env bash")).toBe(true)
    expect(raw).toContain(".devcontainer/Dockerfile")
  })

  test("#given a containerized harness #when reading .devcontainer/devcontainer.json #then host provider creds pass through via remoteEnv", () => {
    // given
    const path = join(REPO_ROOT, ".devcontainer", "devcontainer.json")

    // when / then
    const raw = read(path)
    expect(raw).toContain("remoteEnv")
    expect(raw).toContain("ANTHROPIC_API_KEY")
    expect(raw).toContain("OPENAI_API_KEY")
    expect(raw).toContain("${localEnv:")
  })

  test("#given a devcontainer user #when reading .devcontainer/README.md #then it guides injecting creds + Codex/Claude/OpenCode config", () => {
    // given
    const path = join(REPO_ROOT, ".devcontainer", "README.md")

    // when / then
    expect(existsSync(path), ".devcontainer/README.md must exist").toBe(true)
    const raw = read(path)
    expect(raw).toContain("ANTHROPIC_API_KEY")
    expect(raw).toContain(".codex")
    expect(raw).toContain(".claude")
    expect(raw).toContain(".config/opencode")
  })

  test("#given the Claude wiring #when reading .gitignore #then .claude/settings.json is force-tracked", () => {
    // given
    const raw = read(join(REPO_ROOT, ".gitignore"))

    // then
    expect(raw).toContain("!.claude/settings.json")
  })
})

describe("Docker QA harness", () => {
  test("#given the QA image #when reading .devcontainer/qa.Dockerfile #then it layers latest opencode + codex on the dev image", () => {
    // given
    const path = join(REPO_ROOT, ".devcontainer", "qa.Dockerfile")

    // then
    expect(existsSync(path), ".devcontainer/qa.Dockerfile must exist").toBe(true)
    const raw = read(path)
    expect(raw).toContain("FROM omo-dev")
    expect(raw).toContain("opencode-ai")
    expect(raw).toContain("@openai/codex")
  })

  test("#given the QA entrypoint #when reading .devcontainer/qa-entrypoint.sh #then it copies host config from a read-only mount", () => {
    // given
    const path = join(REPO_ROOT, ".devcontainer", "qa-entrypoint.sh")

    // then
    expect(existsSync(path), ".devcontainer/qa-entrypoint.sh must exist").toBe(true)
    const raw = read(path)
    expect(raw.startsWith("#!/usr/bin/env bash")).toBe(true)
    expect(raw).toContain("/mnt/host")
    expect(raw).toContain("rsync")
  })

  test("#given the runner #when reading script/agent/qa-docker.sh #then it is disposable with local + Windows fallback", () => {
    // given
    const path = join(AGENT_DIR, "qa-docker.sh")

    // then
    expect(existsSync(path), "script/agent/qa-docker.sh must exist").toBe(true)
    const raw = read(path)
    expect(raw).toContain("docker run --rm")
    expect(raw.toLowerCase()).toContain("windows")
    expect(raw).toContain(".devcontainer/qa.Dockerfile")
  })

  test("#given both QA skills #when looking for the docker-qa reference #then each documents the Docker path", () => {
    // given
    const oc = join(REPO_ROOT, ".agents", "skills", "opencode-qa", "references", "docker-qa.md")
    const cx = join(REPO_ROOT, ".claude", "skills", "codex-qa", "references", "docker-qa.md")

    // then
    expect(existsSync(oc), "opencode-qa needs references/docker-qa.md").toBe(true)
    expect(existsSync(cx), "codex-qa needs references/docker-qa.md").toBe(true)
    expect(read(oc)).toContain("qa-docker.sh")
    expect(read(cx)).toContain("qa-docker.sh")
  })
})
