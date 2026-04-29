# src/agents/hephaestus/ -- 자율 심층 작업자

**생성일:** 2026-04-11

## 개요

6개 파일. Hephaestus 에이전트 -- GPT-5.5로 구동되는 자율 심층 작업자. 목표 지향적: 단계별 지시가 아닌 목표를 부여한다. "정통 장인 (The Legitimate Craftsman)."

## 파일

| 파일 | 목적 |
|------|---------|
| `agent.ts` | `createHephaestusAgent()` 팩토리, 모델 변형 라우팅 |
| `gpt.ts` | 기본 GPT 프롬프트: 규율 규칙, 위임, 검증 |
| `gpt-5-4.ts` | XML 태그 블록 기반 GPT-5.4 네이티브 프롬프트, 엔트로피 감소 |
| `gpt-5-3-codex.ts` | 작업 규율 섹션을 갖춘 GPT-5.3 Codex 변형 |
| `index.ts` | Barrel exports |

## 주요 동작

- 모드: `primary` (UI 모델 선택을 존중)
- OpenAI 호환 프로바이더 필요 (fallback chain 없음)
- 서브에이전트의 자가 보고를 절대 신뢰하지 않음 -- 항상 검증
- `background_cancel(all=true)`를 절대 사용하지 않음
- 탐색은 백그라운드 에이전트에 위임, 순차 실행 금지
- explore/librarian에 `run_in_background=true` 사용

## 모델 변형

| 모델 | 프롬프트 소스 | 최적화 |
|-------|-------------|---------------|
| gpt-5.5 | `gpt-5-5.ts` | GPT-5.5에 튜닝된 프롬프트 아키텍처 |
| gpt-5.4 | `gpt-5-4.ts` | XML 태그 블록, 8개 섹션 |
| gpt-5.3-codex | `gpt-5-3-codex.ts` | 작업 규율, 549 LOC 프롬프트 |
| 기타 GPT | `gpt.ts` | 기본 프롬프트, 507 LOC |
