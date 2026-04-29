# src/hooks/ — 52개의 라이프사이클 훅(hook)

**생성일:** 2026-04-18

## 개요

전용 모듈과 단독 파일에 걸친 52개의 훅. 3계층 구성: Core(43) + Continuation(7) + Skill(2). 모든 훅은 `createXXXHook(deps) → HookFunction` 팩토리 패턴을 따름.

## 훅 계층

### 계층 1: Session Hooks (24) — `create-session-hooks.ts`
## 구조
```
hooks/
├── agent-usage-reminder/         # 사용 가능한 에이전트에 대해 알림
├── atlas/                      # 메인 오케스트레이션 (757 lines)
├── anthropic-context-window-limit-recovery/ # 자동 요약
├── anthropic-effort/            # 추론 노력 수준 조정
├── auto-slash-command/         # /command 패턴 감지
├── auto-update-checker/        # 플러그인 업데이트 확인
├── background-notification/    # OS 알림
├── category-skill-reminder/    # 카테고리 스킬 알림
├── claude-code-hooks/          # settings.json 호환 레이어
├── comment-checker/            # AI slop 방지
├── compaction-context-injector/ # 컴팩션 시 컨텍스트 주입
├── compaction-todo-preserver/  # 컴팩션 중에 todo 보존
├── delegate-task-retry/        # 실패한 위임 재시도
├── directory-agents-injector/  # AGENTS.md 자동 주입
├── directory-readme-injector/  # README.md 자동 주입
├── edit-error-recovery/        # 실패 복구
├── hashline-edit-diff-enhancer/ # 해시라인 편집을 위한 향상된 diff 출력
├── hashline-read-enhancer/     # Read 출력에 LINE#ID 해시 추가
├── interactive-bash-session/   # Tmux 세션 관리
├── json-error-recovery/        # JSON 파싱 에러 보정
├── keyword-detector/           # ultrawork/search/analyze 모드
├── legacy-plugin-toast/        # 레거시 플러그인 이름 마이그레이션 토스트
├── model-fallback/             # 프로바이더 레벨 모델 폴백
├── no-hephaestus-non-gpt/      # Hephaestus의 비-GPT 사용 차단
├── no-sisyphus-gpt/            # Sisyphus의 GPT 사용 차단
├── non-interactive-env/        # 비-TTY 환경 처리
├── prometheus-md-only/         # Planner 읽기 전용 모드
├── question-label-truncator/   # 질문 라벨 자동 절단
├── ralph-loop/                 # 자기 참조형 개발 루프
├── read-image-resizer/         # 컨텍스트 효율을 위한 이미지 리사이즈
├── rules-injector/             # 조건부 규칙
├── runtime-fallback/           # API 에러 시 모델 자동 전환
├── session-recovery/           # 크래시 자동 복구
├── sisyphus-junior-notepad/    # Sisyphus Junior 노트패드
├── start-work/                 # Sisyphus 작업 세션 시작자
├── stop-continuation-guard/    # stop continuation 가드
├── task-reminder/              # 태스크 시스템 사용 알림
├── task-resume-info/           # 취소된 태스크에 대한 재개 정보
├── tasks-todowrite-disabler/   # 태스크 시스템 활성 시 TodoWrite 비활성화
├── think-mode/                 # 동적 사고 예산
├── thinking-block-validator/   # 유효한 <thinking> 보장
├── todo-continuation-enforcer/ # TODO 완료 강제
├── todo-description-override/  # todo 설명 오버라이드
├── tool-pair-validator/        # 도구 쌍 사용 검증
├── unstable-agent-babysitter/  # 불안정한 에이전트 동작 모니터링
├── webfetch-redirect-guard/    # webfetch 리디렉션 동작 가드
├── write-existing-file-guard/  # Write 전 Read 요구
└── index.ts                    # 훅 집계 + 등록
```

| Hook | Event | 목적 |
|------|-------|---------|
| contextWindowMonitor | session.idle | 컨텍스트 윈도우 사용량 추적 |
| preemptiveCompaction | session.idle | 한계 도달 전 컴팩션 트리거 |
| sessionRecovery | session.error | 복구 가능한 에러 발생 시 자동 재시도 |
| sessionNotification | session.idle | 완료 시 OS 알림 |
| thinkMode | chat.params | 모델 변형 전환 (확장 사고) |
| anthropicContextWindowLimitRecovery | session.error | 다중 전략 컨텍스트 복구 (절단, 컴팩션) |
| autoUpdateChecker | session.created | 플러그인 업데이트 npm 확인 |
| agentUsageReminder | chat.message | 사용 가능한 에이전트 알림 |
| nonInteractiveEnv | chat.message | `run` 명령에 맞춰 동작 조정 |
| interactiveBashSession | tool.execute | 인터랙티브 도구를 위한 Tmux 세션 |
| ralphLoop | event | 자기 참조형 개발 루프 (boulder continuation) |
| editErrorRecovery | tool.execute.after | 실패한 파일 편집 재시도 |
| delegateTaskRetry | tool.execute.after | 실패한 태스크 위임 재시도 |
| startWork | chat.message | `/start-work` 명령 핸들러 |
| prometheusMdOnly | tool.execute.before | Prometheus 한정 .md 전용 쓰기 강제 |
| sisyphusJuniorNotepad | chat.message | 서브에이전트용 노트패드 주입 |
| questionLabelTruncator | tool.execute.before | 긴 질문 라벨 절단 |
| taskResumeInfo | chat.message | 재개 시 태스크 컨텍스트 주입 |
| anthropicEffort | chat.params | 추론 노력 수준 조정 |
| modelFallback | chat.params | 에러 시 프로바이더 레벨 모델 폴백 |
| noSisyphusGpt | chat.message | Sisyphus의 GPT 모델 사용 차단 (토스트 경고) |
| noHephaestusNonGpt | chat.message | Hephaestus의 비-GPT 모델 사용 차단 |
| runtimeFallback | event | API 프로바이더 에러 시 모델 자동 전환 |
| legacyPluginToast | chat.message | 레거시 플러그인 이름 감지 시 토스트 표시 |

### 계층 2: Tool Guard Hooks (14) — `create-tool-guard-hooks.ts`

| Hook | Event | 목적 |
|------|-------|---------|
| commentChecker | tool.execute.after | AI 생성 주석 패턴 차단 |
| toolOutputTruncator | tool.execute.after | 과도한 도구 출력 절단 |
| directoryAgentsInjector | tool.execute.before | 디렉토리 AGENTS.md를 컨텍스트에 주입 |
| directoryReadmeInjector | tool.execute.before | 디렉토리 README.md를 컨텍스트에 주입 |
| emptyTaskResponseDetector | tool.execute.after | 빈 태스크 응답 감지 |
| rulesInjector | tool.execute.before | 조건부 규칙 주입 (AGENTS.md, config) |
| tasksTodowriteDisabler | tool.execute.before | 태스크 시스템 활성 시 TodoWrite 비활성화 |
| writeExistingFileGuard | tool.execute.before | 기존 파일에 대한 Write 전 Read 요구 |
| bashFileReadGuard | tool.execute.before | 파일을 읽는 bash 명령 가드 |
| readImageResizer | tool.execute.after | 컨텍스트 효율을 위해 큰 이미지 리사이즈 |
| todoDescriptionOverride | tool.execute.before | todo 항목 설명 오버라이드 |
| webfetchRedirectGuard | tool.execute.before | webfetch 리디렉션 동작 가드 |
| hashlineReadEnhancer | tool.execute.after | 라인 해시로 Read 출력 강화 |
| jsonErrorRecovery | tool.execute.after | JSON 파싱 에러 감지, 보정 알림 주입 |

### 계층 3: Transform Hooks (5) — `create-transform-hooks.ts`

| Hook | Event | 목적 |
|------|-------|---------|
| claudeCodeHooks | messages.transform | Claude Code settings.json 호환성 |
| keywordDetector | messages.transform | ultrawork/search/analyze 모드 감지 |
| contextInjectorMessagesTransform | messages.transform | AGENTS.md/README.md를 컨텍스트에 주입 |
| thinkingBlockValidator | messages.transform | 사고 블록 구조 검증 |
| toolPairValidator | messages.transform | 도구 호출/결과 쌍 검증 |

### 계층 4: Continuation Hooks (7) — `create-continuation-hooks.ts`

| Hook | Event | 목적 |
|------|-------|---------|
| stopContinuationGuard | chat.message | `/stop-continuation` 명령 핸들러 |
| compactionContextInjector | session.compacted | 컴팩션 후 컨텍스트 재주입 |
| compactionTodoPreserver | session.compacted | 컴팩션 중에 todo 보존 |
| todoContinuationEnforcer | session.idle | **Boulder**: 미완료 todo가 있을 때 continuation 강제 |
| unstableAgentBabysitter | session.idle | 불안정한 에이전트 동작 모니터링 |
| backgroundNotificationHook | event | 백그라운드 태스크 완료 알림 |
| atlasHook | event | boulder/백그라운드 세션의 마스터 오케스트레이터 |

### 계층 5: Skill Hooks (2) — `create-skill-hooks.ts`

| Hook | Event | 목적 |
|------|-------|---------|
| categorySkillReminder | chat.message | 카테고리+스킬 위임 알림 |
| autoSlashCommand | chat.message | 사용자 입력에서 `/command` 자동 감지 |

## 주요 훅 (복잡)

### anthropic-context-window-limit-recovery (31개 파일, ~2232 LOC)
컨텍스트 한계 도달 시 다중 전략 복구. 전략: 절단, 컴팩션, 요약.

### atlas (17개 파일, ~1976 LOC)
boulder 세션의 마스터 오케스트레이터. 결정 게이트: 세션 타입 → abort 검사 → 실패 횟수 → 백그라운드 태스크 → 에이전트 매치 → 계획 완성도 → 쿨다운 (5s). session.idle에서 continuation 프롬프트 주입.

### ralph-loop (14개 파일, ~1687 LOC)
`/ralph-loop` 명령을 통한 자기 참조형 개발 루프. 상태는 `.sisyphus/ralph-loop.local.md`에 영속화. AI 출력에서 `<promise>DONE</promise>` 감지. 기본 최대 100회 반복.

### todo-continuation-enforcer (13개 파일, ~2061 LOC)
"Boulder" 메커니즘. todo가 미완료로 남아 있을 때 에이전트가 계속하도록 강제. 2초 카운트다운 토스트 → continuation 주입. 지수 백오프: 30초 기본, 실패당 ×2, 연속 5회 실패 시 5분 일시정지.

### keyword-detector (~1665 LOC)
사용자 입력에서 모드 감지: ultrawork, search, analyze, prove-yourself. 모드별 시스템 프롬프트 주입.

### rules-injector (19개 파일, ~1604 LOC)
AGENTS.md, config, 스킬 규칙으로부터의 조건부 규칙 주입. 어떤 규칙이 적용될지 결정하기 위해 조건을 평가.

## 단독 훅 (src/hooks/ 루트에 위치)

| 파일 | 목적 |
|------|---------|
| context-window-monitor.ts | 컨텍스트 윈도우 백분율 추적 |
| preemptive-compaction.ts | 하드 한계 전에 컴팩션 트리거 |
| tool-output-truncator.ts | 토큰 수 기준 도구 출력 절단 |
| session-notification.ts + 4 helpers | 세션 완료 시 OS 알림 |
| empty-task-response-detector.ts | 비어 있거나 실패한 태스크 응답 감지 |
| session-todo-status.ts | todo 완료 상태 추적 |

## 훅 추가 방법

1. `createXXXHook(deps)` 팩토리를 가진 `src/hooks/{name}/index.ts` 생성
2. 적절한 계층 파일(`src/plugin/hooks/create-{tier}-hooks.ts`)에 등록
3. `src/config/schema/hooks.ts`의 HookNameSchema에 훅 이름 추가
4. 훅은 `(event, ctx)`를 받음 — 반환값은 이벤트 타입에 따라 다름
