# src/agents/ — 11개 에이전트 정의

**생성일:** 2026-04-18

## 개요

에이전트 팩토리는 `createXXXAgent(model) → AgentConfig` 패턴을 따릅니다. 각각 정적 `mode` 속성을 가집니다. `buildAgent()`를 통해 팩토리 + 카테고리 + 스킬을 합성하여 빌드합니다.

## 에이전트 목록

| 에이전트 | 모델 | Temp | 모드 | Fallback Chain | 목적 |
|-------|-------|------|------|----------------|---------|
| **Sisyphus** | claude-opus-4-7 max | 0.1 | all | k2p5 -> kimi-k2.5 -> gpt-5.5 medium -> glm-5 -> big-pickle | 메인 오케스트레이터, 계획 + 위임 |
| **Hephaestus** | gpt-5.5 medium | 0.1 | all | — | 자율 심층 작업자 |
| **Oracle** | gpt-5.5 high | 0.1 | subagent | gemini-3.1-pro high -> claude-opus-4-7 max | 읽기 전용 컨설팅 |
| **Librarian** | gpt-5.4-mini-fast | 0.1 | subagent | minimax-m2.7-highspeed -> minimax-m2.7 -> claude-haiku-4-5 -> gpt-5.4-nano | 외부 문서/코드 검색 |
| **Explore** | gpt-5.4-mini-fast | 0.1 | subagent | minimax-m2.7-highspeed -> minimax-m2.7 -> claude-haiku-4-5 -> gpt-5.4-nano | 컨텍스트 grep |
| **Multimodal-Looker** | gpt-5.3-codex medium | 0.1 | subagent | k2p5 -> gemini-3-flash -> glm-4.6v -> gpt-5-nano | PDF/이미지 분석 |
| **Metis** | claude-opus-4-7 max | **0.3** | subagent | gpt-5.5 high -> gemini-3.1-pro high | 사전 계획 컨설턴트 |
| **Momus** | gpt-5.5 xhigh | 0.1 | subagent | claude-opus-4-7 max -> gemini-3.1-pro high | 계획 리뷰어 |
| **Atlas** | claude-sonnet-4-6 | 0.1 | primary | gpt-5.5 medium | Todo 리스트 오케스트레이터 |
| **Prometheus** | claude-opus-4-7 max | 0.1 | — | internal planner | 전략 플래너 (내부) |
| **Sisyphus-Junior** | claude-sonnet-4-6 | 0.1 | all | 사용자 설정 가능 | 카테고리 기반 spawn 실행자 |

## 도구 제한

| 에이전트 | 거부된 도구 |
|-------|-------------|
| Oracle | write, edit, task, call_omo_agent |
| Librarian | write, edit, task, call_omo_agent |
| Explore | write, edit, task, call_omo_agent |
| Multimodal-Looker | read를 제외한 전부 |
| Atlas | task, call_omo_agent |
| Momus | write, edit, task |

## 구조

```
agents/
├── sisyphus.ts            # 559 LOC, 메인 오케스트레이터
├── hephaestus.ts          # 507 LOC, 자율 작업자
├── oracle.ts              # 읽기 전용 컨설턴트
├── librarian.ts           # 외부 검색
├── explore.ts             # 코드베이스 grep
├── multimodal-looker.ts   # 비전/PDF
├── metis.ts               # 사전 계획
├── momus.ts               # 계획 리뷰
├── atlas/agent.ts         # Todo 오케스트레이터
├── types.ts               # AgentFactory, AgentMode
├── agent-builder.ts       # buildAgent() 합성
├── utils.ts               # 에이전트 유틸리티
├── builtin-agents.ts      # createBuiltinAgents() 레지스트리
├── dynamic-agent-prompt-builder.ts    # 동적 프롬프트 빌더 시스템
├── dynamic-agent-core-sections.ts   # Core 프롬프트 섹션
├── dynamic-agent-policy-sections.ts # Policy 프롬프트 섹션
├── dynamic-agent-tool-categorization.ts # 도구 분류
├── dynamic-agent-category-skills-guide.ts # 카테고리 스킬 가이드
├── custom-agent-summaries.ts        # 커스텀 에이전트 요약
├── env-context.ts                   # 환경 컨텍스트
└── builtin-agents/        # maybeCreateXXXConfig 조건부 팩토리
    ├── sisyphus-agent.ts
    ├── hephaestus-agent.ts
    ├── atlas-agent.ts
    ├── general-agents.ts  # collectPendingBuiltinAgents
    └── available-skills.ts
```

## 팩토리 패턴

```typescript
const createXXXAgent: AgentFactory = (model: string) => ({
  instructions: "...",
  model,
  temperature: 0.1,
  // ...config
})
createXXXAgent.mode = "subagent" // or "primary" or "all"
```

모델 해석: 4단계: override → category-default → provider-fallback → system-default. `shared/model-requirements.ts`에 정의되어 있습니다.

## 모드

- **primary**: UI에서 선택된 모델을 존중하며, fallback chain 사용
- **subagent**: 자체 fallback chain 사용, UI 선택 무시
- **all**: 두 컨텍스트 모두에서 사용 가능 (Sisyphus-Junior)
