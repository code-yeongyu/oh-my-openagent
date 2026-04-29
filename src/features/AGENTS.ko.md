# src/features/ — 19개 기능 모듈

**생성일:** 2026-04-18

## 개요

plugin/ 레이어에 연결된 독립형 기능 모듈들. 각 모듈은 자체 타입, 구현, 테스트를 갖춘 자립형 모듈입니다.

## 모듈 맵

| 모듈 | 파일 수 | 복잡도 | 목적 |
|--------|-------|------------|---------|
| **opencode-skill-loader** | 33 | HIGH | 4개 스코프에서 YAML frontmatter 스킬 로딩 |
| **background-agent** | 47 | HIGH | 태스크 라이프사이클, 동시성 (모델당 5개), 폴링, spawner 패턴, 서킷 브레이커 |
| **tmux-subagent** | 34 | HIGH | Tmux pane 관리, 그리드 플래닝, 세션 오케스트레이션 |
| **mcp-oauth** | 18 | HIGH | MCP 서버용 OAuth 2.0 + PKCE + DCR (RFC 7591) |
| **builtin-skills** | 17 | LOW | 8개 스킬: git-master, playwright, playwright-cli, agent-browser, dev-browser, frontend-ui-ux, review-work, ai-slop-remover |
| **skill-mcp-manager** | 18 | HIGH | 세션별 Tier-3 MCP 클라이언트 라이프사이클 (stdio + HTTP + OAuth step-up) |
| **claude-code-plugin-loader** | 15 | MEDIUM | .opencode/plugins/ 에서 플러그인 통합 디스커버리 |
| **builtin-commands** | 11 | LOW | 명령 템플릿: refactor, init-deep, handoff 등 |
| **claude-tasks** | 7 | MEDIUM | 태스크 스키마 + 파일 저장 + OpenCode todo 동기화 |
| **claude-code-mcp-loader** | 6 | MEDIUM | ${VAR} 환경변수 확장이 가능한 .mcp.json 로딩 |
| **context-injector** | 6 | MEDIUM | AGENTS.md/README.md 컨텍스트 주입 |
| **run-continuation-state** | 5 | LOW | 세션 간 `run` 명령 이어서 실행을 위한 영속 상태 |
| **hook-message-injector** | 5 | MEDIUM | 훅용 시스템 메시지 주입 |
| **boulder-state** | 5 | LOW | 다단계 작업의 영속 상태 |
| **task-toast-manager** | 4 | MEDIUM | 태스크 진행 알림 |
| **tool-metadata-store** | 3 | LOW | 도구 실행 메타데이터 캐시 |
| **claude-code-session-state** | 3 | LOW | 서브에이전트 세션 상태 추적 |
| **claude-code-command-loader** | 3 | LOW | .opencode/commands/ 에서 명령 로딩 |
| **claude-code-agent-loader** | 3 | LOW | .opencode/agents/ 에서 에이전트 로딩 |

## 주요 모듈

### background-agent (47개 파일, 약 10k LOC)

핵심 오케스트레이션 엔진. `BackgroundManager` 가 태스크 라이프사이클을 관리:
- 상태: pending → running → completed/error/cancelled/interrupt
- 동시성: `ConcurrencyManager` 를 통한 모델/프로바이더별 제한 (FIFO 큐)
- 폴링: 3초 간격, idle 이벤트 + 안정성 감지(10초 동안 변화 없음)로 완료 판정
- 서킷 브레이커: 자동 실패 감지 및 복구
- spawner/: `SpawnerContext` 인터페이스로 합성된 8개의 집중된 파일

### opencode-skill-loader (33개 파일, 약 3.2k LOC)

4단계 스코프 스킬 디스커버리 (project > opencode > user > global):
- SKILL.md 파일에서 YAML frontmatter 파싱
- 우선순위 중복 제거가 포함된 스킬 머저
- 변수 치환을 통한 템플릿 해석
- 모델별 스킬에 대한 프로바이더 게이팅

### tmux-subagent (34개 파일, 약 3.6k LOC)

상태 우선 tmux 통합:
- `TmuxSessionManager`: pane 라이프사이클, 그리드 플래닝
- 스폰 액션 결정자 + 타깃 파인더
- 세션 헬스용 폴링 매니저
- pane 생성/제거 이벤트 핸들러

### builtin-skills (8개 스킬 객체)

| 스킬 | 크기 | MCP | 도구 |
|-------|------|-----|-------|
| git-master | 1111 LOC | — | Bash |
| playwright | 312 LOC | @playwright/mcp | — |
| agent-browser | (playwright.ts 내) | — | Bash(agent-browser:*) |
| playwright-cli | 268 LOC | — | Bash(playwright-cli:*) |
| dev-browser | 221 LOC | — | Bash |
| frontend-ui-ux | 79 LOC | — | — |
| review-work | ~LOC | --- | --- |
| ai-slop-remover | ~LOC | --- | --- |

브라우저 변형은 `browserProvider` 설정으로 선택: playwright (기본) | playwright-cli | agent-browser.
