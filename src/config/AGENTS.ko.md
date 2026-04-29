# src/config/ — Zod v4 스키마 시스템

**생성일:** 2026-04-18

## 개요

`OhMyOpenCodeConfigSchema`를 구성하는 32개 스키마 파일. `safeParse()`를 사용하는 Zod v4 검증. 모든 필드는 선택사항 — 누락된 필드는 플러그인 기본값을 사용.

## 스키마 트리

```
config/schema/
├── oh-my-opencode-config.ts    # ROOT: OhMyOpenCodeConfigSchema (이하 모두 합성)
├── agent-names.ts              # BuiltinAgentNameSchema (11), OverridableAgentNameSchema (14)
├── agent-overrides.ts          # AgentOverrideConfigSchema (에이전트당 21개 필드)
├── categories.ts               # 8개 빌트인 + 커스텀 카테고리
├── hooks.ts                    # HookNameSchema (48 hooks)
├── skills.ts                   # SkillsConfigSchema (sources, paths, recursive)
├── commands.ts                 # BuiltinCommandNameSchema
├── experimental.ts             # 기능 플래그 (plugin_load_timeout_ms 최소 1000)
├── sisyphus.ts                 # SisyphusConfigSchema (작업 시스템)
├── sisyphus-agent.ts           # SisyphusAgentConfigSchema
├── ralph-loop.ts               # RalphLoopConfigSchema
├── tmux.ts                     # TmuxConfigSchema + TmuxLayoutSchema
├── websearch.ts                # provider: "exa" | "tavily"
├── claude-code.ts              # CC 호환성 설정
├── comment-checker.ts          # AI 주석 감지 설정
├── notification.ts             # OS 알림 설정
├── git-master.ts               # commit_footer: boolean | string
├── browser-automation.ts       # provider: playwright | agent-browser | playwright-cli
├── background-task.ts          # 모델/프로바이더당 동시 실행 한도
├── fallback-models.ts          # FallbackModelsConfigSchema
├── runtime-fallback.ts         # RuntimeFallbackConfigSchema
├── babysitting.ts              # 불안정 에이전트 모니터링
├── dynamic-context-pruning.ts  # 컨텍스트 프루닝 설정
├── start-work.ts              # StartWorkConfigSchema (auto_commit)
├── openclaw.ts                # OpenClaw 통합 설정
├── git-env-prefix.ts          # Git 환경 prefix 설정
├── model-capabilities.ts      # 모델 capability 설정
└── internal/permission.ts      # AgentPermissionSchema

```

## 루트 스키마 필드 (32개)

`$schema`, `new_task_system_enabled`, `default_run_agent`, `disabled_mcps`, `disabled_agents`, `disabled_skills`, `disabled_hooks`, `disabled_commands`, `disabled_tools`, `hashline_edit`, `agents`, `categories`, `claude_code`, `sisyphus_agent`, `comment_checker`, `experimental`, `auto_update`, `skills`, `ralph_loop`, `background_task`, `notification`, `babysitting`, `git_master`, `browser_automation_engine`, `websearch`, `tmux`, `sisyphus`, `start_work`, `_migrations`, `model_fallback`, `model_capabilities`, `openclaw`, `mcp_env_allowlist`

## 에이전트 오버라이드 필드 (21개)

`model`, `variant`, `category`, `skills`, `temperature`, `top_p`, `prompt`, `prompt_append`, `tools`, `disable`, `description`, `mode`, `color`, `permission`, `maxTokens`, `thinking`, `reasoningEffort`, `textVerbosity`, `providerOptions`

## 설정 추가 방법

1. Zod 스키마와 함께 `src/config/schema/{name}.ts` 생성
2. `oh-my-opencode-config.ts` 루트 스키마에 필드 추가
3. TypeScript 타입을 위해 `z.infer<typeof YourSchema>`로 참조
4. 핸들러에서 `pluginConfig.{name}`으로 접근
