# src/agents/prometheus/ -- 전략 플래너

**생성일:** 2026-04-11

## 개요

11개 파일. Prometheus 에이전트 -- 인터뷰 모드 전략 플래너. 코드를 작성하기 전에 코드베이스를 읽고, 사용자에게 질문하고, 상세한 작업 계획을 세운다. Markdown 전용 출력 (`prometheus-md-only` 훅으로 강제됨).

## 파일

| 파일 | 목적 |
|------|---------|
| `system-prompt.ts` | 섹션들로부터 전체 시스템 프롬프트 구성 |
| `identity-constraints.ts` | 금지 행동, .md 전용 강제, 경로 제한 |
| `interview-mode.ts` | 인터뷰 흐름: 요구사항 수집, 범위 명확화 |
| `plan-generation.ts` | 계획 출력 구조 및 검증 |
| `plan-template.ts` | 작업 그래프, 의존성, wave 포함 YAML 계획 템플릿 |
| `behavioral-summary.ts` | 행동 가이드라인 섹션 |
| `high-accuracy-mode.ts` | 복잡한 계획을 위한 고정확도 모드 |
| `gemini.ts` | Gemini 최적화 프롬프트 변형 |
| `gpt.ts` | GPT 최적화 프롬프트 변형 |
| `index.ts` | Barrel exports |

## 주요 제약

- `.md` 파일만 생성/편집 가능 (훅으로 강제)
- 금지 경로: `src/`, `package.json`, 설정 파일
- 계획 전에 반드시 코드베이스 탐색 (맹목적 계획 금지)
- 계획은 `.sisyphus/plans/`에 저장
- "사용자가 수동 테스트"를 요구하는 수락 기준은 금지

## 계획 출력 형식

병렬 작업 그래프를 가진 YAML 사용:
- Wave (병렬 실행 그룹)
- 의존성, 카테고리, 스킬을 갖는 Task
- 각 Task는 atomic scope + 검증 기준을 가짐
