# 한국어 번역 인덱스

이 레포지토리의 모든 지침(AGENTS.md), 스킬(SKILL.md), 명령어, 가이드 문서의 한국어 번역본 모음입니다.
원본은 같은 디렉토리의 동일 이름 파일(`.ko.md` 접미사 제거)을 참조하세요.

총 **72개 파일**.

---

## 1. 프로젝트 루트

| 문서 | 원본 |
|---|---|
| [AGENTS.ko.md](AGENTS.ko.md) — 프로젝트 전반의 에이전트 지침 | [AGENTS.md](AGENTS.md) |
| [CONTRIBUTING.ko.md](CONTRIBUTING.ko.md) — 기여 가이드 | [CONTRIBUTING.md](CONTRIBUTING.md) |

## 2. 사용자 가이드 (`docs/`)

### Guide
| 문서 | 원본 |
|---|---|
| [overview.ko.md](docs/guide/overview.ko.md) — 개요 | [overview.md](docs/guide/overview.md) |
| [installation.ko.md](docs/guide/installation.ko.md) — 설치 | [installation.md](docs/guide/installation.md) |
| [orchestration.ko.md](docs/guide/orchestration.ko.md) — 오케스트레이션 | [orchestration.md](docs/guide/orchestration.md) |
| [agent-model-matching.ko.md](docs/guide/agent-model-matching.ko.md) — 에이전트–모델 매칭 | [agent-model-matching.md](docs/guide/agent-model-matching.md) |

### Reference
| 문서 | 원본 |
|---|---|
| [cli.ko.md](docs/reference/cli.ko.md) — CLI 레퍼런스 | [cli.md](docs/reference/cli.md) |
| [configuration.ko.md](docs/reference/configuration.ko.md) — 설정 레퍼런스 | [configuration.md](docs/reference/configuration.md) |
| [features.ko.md](docs/reference/features.ko.md) — 기능 레퍼런스 | [features.md](docs/reference/features.md) |

### Troubleshooting
| 문서 | 원본 |
|---|---|
| [ollama.ko.md](docs/troubleshooting/ollama.ko.md) — Ollama 문제 해결 | [ollama.md](docs/troubleshooting/ollama.md) |

### 기타
| 문서 | 원본 |
|---|---|
| [manifesto.ko.md](docs/manifesto.ko.md) — 매니페스토 | [manifesto.md](docs/manifesto.md) |
| [model-capabilities-maintenance.ko.md](docs/model-capabilities-maintenance.ko.md) — 모델 capability 유지보수 | [model-capabilities-maintenance.md](docs/model-capabilities-maintenance.md) |

## 3. OpenCode 명령어 & 스킬 (`.opencode/`)

### Commands
| 문서 | 원본 |
|---|---|
| [get-unpublished-changes.ko.md](.opencode/command/get-unpublished-changes.ko.md) | [get-unpublished-changes.md](.opencode/command/get-unpublished-changes.md) |
| [omomomo.ko.md](.opencode/command/omomomo.ko.md) | [omomomo.md](.opencode/command/omomomo.md) |
| [publish.ko.md](.opencode/command/publish.ko.md) | [publish.md](.opencode/command/publish.md) |
| [remove-deadcode.ko.md](.opencode/command/remove-deadcode.ko.md) | [remove-deadcode.md](.opencode/command/remove-deadcode.md) |

### Skills
| 문서 | 원본 |
|---|---|
| [github-triage/SKILL.ko.md](.opencode/skills/github-triage/SKILL.ko.md) | [SKILL.md](.opencode/skills/github-triage/SKILL.md) |
| [pre-publish-review/SKILL.ko.md](.opencode/skills/pre-publish-review/SKILL.ko.md) | [SKILL.md](.opencode/skills/pre-publish-review/SKILL.md) |
| [work-with-pr/SKILL.ko.md](.opencode/skills/work-with-pr/SKILL.ko.md) | [SKILL.md](.opencode/skills/work-with-pr/SKILL.md) |

## 4. 에이전트 프롬프트 초안 (`drafts/gpt-5-5/`)

| 문서 | 원본 |
|---|---|
| [sisyphus.ko.md](drafts/gpt-5-5/sisyphus.ko.md) | [sisyphus.md](drafts/gpt-5-5/sisyphus.md) |
| [sisyphus-junior.ko.md](drafts/gpt-5-5/sisyphus-junior.ko.md) | [sisyphus-junior.md](drafts/gpt-5-5/sisyphus-junior.md) |
| [hephaestus.ko.md](drafts/gpt-5-5/hephaestus.ko.md) | [hephaestus.md](drafts/gpt-5-5/hephaestus.md) |
| [oracle.ko.md](drafts/gpt-5-5/oracle.ko.md) | [oracle.md](drafts/gpt-5-5/oracle.md) |
| [deep.ko.md](drafts/gpt-5-5/deep.ko.md) | [deep.md](drafts/gpt-5-5/deep.md) |

## 5. 소스 트리 지침 (`src/`)

### 최상위
| 문서 | 원본 |
|---|---|
| [src/AGENTS.ko.md](src/AGENTS.ko.md) | [AGENTS.md](src/AGENTS.md) |

### Agents (`src/agents/`)
| 문서 | 원본 |
|---|---|
| [agents/AGENTS.ko.md](src/agents/AGENTS.ko.md) | [AGENTS.md](src/agents/AGENTS.md) |
| [agents/sisyphus/AGENTS.ko.md](src/agents/sisyphus/AGENTS.ko.md) | [AGENTS.md](src/agents/sisyphus/AGENTS.md) |
| [agents/hephaestus/AGENTS.ko.md](src/agents/hephaestus/AGENTS.ko.md) | [AGENTS.md](src/agents/hephaestus/AGENTS.md) |
| [agents/prometheus/AGENTS.ko.md](src/agents/prometheus/AGENTS.ko.md) | [AGENTS.md](src/agents/prometheus/AGENTS.md) |

### CLI (`src/cli/`)
| 문서 | 원본 |
|---|---|
| [cli/AGENTS.ko.md](src/cli/AGENTS.ko.md) | [AGENTS.md](src/cli/AGENTS.md) |
| [cli/config-manager/AGENTS.ko.md](src/cli/config-manager/AGENTS.ko.md) | [AGENTS.md](src/cli/config-manager/AGENTS.md) |
| [cli/doctor/AGENTS.ko.md](src/cli/doctor/AGENTS.ko.md) | [AGENTS.md](src/cli/doctor/AGENTS.md) |
| [cli/run/AGENTS.ko.md](src/cli/run/AGENTS.ko.md) | [AGENTS.md](src/cli/run/AGENTS.md) |

### Config / MCP / Plugin / Shared
| 문서 | 원본 |
|---|---|
| [config/AGENTS.ko.md](src/config/AGENTS.ko.md) | [AGENTS.md](src/config/AGENTS.md) |
| [mcp/AGENTS.ko.md](src/mcp/AGENTS.ko.md) | [AGENTS.md](src/mcp/AGENTS.md) |
| [openclaw/AGENTS.ko.md](src/openclaw/AGENTS.ko.md) | [AGENTS.md](src/openclaw/AGENTS.md) |
| [plugin/AGENTS.ko.md](src/plugin/AGENTS.ko.md) | [AGENTS.md](src/plugin/AGENTS.md) |
| [plugin-handlers/AGENTS.ko.md](src/plugin-handlers/AGENTS.ko.md) | [AGENTS.md](src/plugin-handlers/AGENTS.md) |
| [shared/AGENTS.ko.md](src/shared/AGENTS.ko.md) | [AGENTS.md](src/shared/AGENTS.md) |

### Features (`src/features/`)
| 문서 | 원본 |
|---|---|
| [features/AGENTS.ko.md](src/features/AGENTS.ko.md) | [AGENTS.md](src/features/AGENTS.md) |
| [features/background-agent/AGENTS.ko.md](src/features/background-agent/AGENTS.ko.md) | [AGENTS.md](src/features/background-agent/AGENTS.md) |
| [features/claude-code-mcp-loader/AGENTS.ko.md](src/features/claude-code-mcp-loader/AGENTS.ko.md) | [AGENTS.md](src/features/claude-code-mcp-loader/AGENTS.md) |
| [features/claude-code-plugin-loader/AGENTS.ko.md](src/features/claude-code-plugin-loader/AGENTS.ko.md) | [AGENTS.md](src/features/claude-code-plugin-loader/AGENTS.md) |
| [features/claude-tasks/AGENTS.ko.md](src/features/claude-tasks/AGENTS.ko.md) | [AGENTS.md](src/features/claude-tasks/AGENTS.md) |
| [features/mcp-oauth/AGENTS.ko.md](src/features/mcp-oauth/AGENTS.ko.md) | [AGENTS.md](src/features/mcp-oauth/AGENTS.md) |
| [features/opencode-skill-loader/AGENTS.ko.md](src/features/opencode-skill-loader/AGENTS.ko.md) | [AGENTS.md](src/features/opencode-skill-loader/AGENTS.md) |
| [features/skill-mcp-manager/AGENTS.ko.md](src/features/skill-mcp-manager/AGENTS.ko.md) | [AGENTS.md](src/features/skill-mcp-manager/AGENTS.md) |
| [features/tmux-subagent/AGENTS.ko.md](src/features/tmux-subagent/AGENTS.ko.md) | [AGENTS.md](src/features/tmux-subagent/AGENTS.md) |

### Built-in Skills (`src/features/builtin-skills/`)
| 문서 | 원본 |
|---|---|
| [builtin-skills/AGENTS.ko.md](src/features/builtin-skills/AGENTS.ko.md) | [AGENTS.md](src/features/builtin-skills/AGENTS.md) |
| [agent-browser/SKILL.ko.md](src/features/builtin-skills/agent-browser/SKILL.ko.md) | [SKILL.md](src/features/builtin-skills/agent-browser/SKILL.md) |
| [dev-browser/SKILL.ko.md](src/features/builtin-skills/dev-browser/SKILL.ko.md) | [SKILL.md](src/features/builtin-skills/dev-browser/SKILL.md) |
| [dev-browser/references/installation.ko.md](src/features/builtin-skills/dev-browser/references/installation.ko.md) | [installation.md](src/features/builtin-skills/dev-browser/references/installation.md) |
| [dev-browser/references/scraping.ko.md](src/features/builtin-skills/dev-browser/references/scraping.ko.md) | [scraping.md](src/features/builtin-skills/dev-browser/references/scraping.md) |
| [frontend-ui-ux/SKILL.ko.md](src/features/builtin-skills/frontend-ui-ux/SKILL.ko.md) | [SKILL.md](src/features/builtin-skills/frontend-ui-ux/SKILL.md) |
| [git-master/SKILL.ko.md](src/features/builtin-skills/git-master/SKILL.ko.md) | [SKILL.md](src/features/builtin-skills/git-master/SKILL.md) |

### Hooks (`src/hooks/`)
| 문서 | 원본 |
|---|---|
| [hooks/AGENTS.ko.md](src/hooks/AGENTS.ko.md) | [AGENTS.md](src/hooks/AGENTS.md) |
| [anthropic-context-window-limit-recovery/AGENTS.ko.md](src/hooks/anthropic-context-window-limit-recovery/AGENTS.ko.md) | [AGENTS.md](src/hooks/anthropic-context-window-limit-recovery/AGENTS.md) |
| [atlas/AGENTS.ko.md](src/hooks/atlas/AGENTS.ko.md) | [AGENTS.md](src/hooks/atlas/AGENTS.md) |
| [claude-code-hooks/AGENTS.ko.md](src/hooks/claude-code-hooks/AGENTS.ko.md) | [AGENTS.md](src/hooks/claude-code-hooks/AGENTS.md) |
| [comment-checker/AGENTS.ko.md](src/hooks/comment-checker/AGENTS.ko.md) | [AGENTS.md](src/hooks/comment-checker/AGENTS.md) |
| [keyword-detector/AGENTS.ko.md](src/hooks/keyword-detector/AGENTS.ko.md) | [AGENTS.md](src/hooks/keyword-detector/AGENTS.md) |
| [ralph-loop/AGENTS.ko.md](src/hooks/ralph-loop/AGENTS.ko.md) | [AGENTS.md](src/hooks/ralph-loop/AGENTS.md) |
| [rules-injector/AGENTS.ko.md](src/hooks/rules-injector/AGENTS.ko.md) | [AGENTS.md](src/hooks/rules-injector/AGENTS.md) |
| [runtime-fallback/AGENTS.ko.md](src/hooks/runtime-fallback/AGENTS.ko.md) | [AGENTS.md](src/hooks/runtime-fallback/AGENTS.md) |
| [session-recovery/AGENTS.ko.md](src/hooks/session-recovery/AGENTS.ko.md) | [AGENTS.md](src/hooks/session-recovery/AGENTS.md) |
| [todo-continuation-enforcer/AGENTS.ko.md](src/hooks/todo-continuation-enforcer/AGENTS.ko.md) | [AGENTS.md](src/hooks/todo-continuation-enforcer/AGENTS.md) |

### Tools (`src/tools/`)
| 문서 | 원본 |
|---|---|
| [tools/AGENTS.ko.md](src/tools/AGENTS.ko.md) | [AGENTS.md](src/tools/AGENTS.md) |
| [background-task/AGENTS.ko.md](src/tools/background-task/AGENTS.ko.md) | [AGENTS.md](src/tools/background-task/AGENTS.md) |
| [call-omo-agent/AGENTS.ko.md](src/tools/call-omo-agent/AGENTS.ko.md) | [AGENTS.md](src/tools/call-omo-agent/AGENTS.md) |
| [delegate-task/AGENTS.ko.md](src/tools/delegate-task/AGENTS.ko.md) | [AGENTS.md](src/tools/delegate-task/AGENTS.md) |
| [hashline-edit/AGENTS.ko.md](src/tools/hashline-edit/AGENTS.ko.md) | [AGENTS.md](src/tools/hashline-edit/AGENTS.md) |
| [lsp/AGENTS.ko.md](src/tools/lsp/AGENTS.ko.md) | [AGENTS.md](src/tools/lsp/AGENTS.md) |

---

## 제외된 항목

다음은 의도적으로 번역에서 제외했습니다.

- `README.md`, `README.ko.md`, `README.ja.md`, `README.zh-cn.md`, `README.ru.md` — 이미 다국어 번역본 존재
- `LICENSE.md`, `CLA.md` — 법률 문서
- `docs/legal/*.md` — 개인정보 처리방침, 약관
- `docs/superpowers/plans|specs/*.md` — 날짜가 박힌 작업 산출물
- `src/__tests__/perf/fixtures/**/AGENTS.md` — 테스트 픽스처
- `.opencode/skills/work-with-pr-workspace/**` — 벤치마크 평가 데이터
- `.github/pull_request_template.md` — GitHub PR 템플릿
