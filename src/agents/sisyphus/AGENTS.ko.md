# src/agents/sisyphus/ -- 오케스트레이터 변형

**생성일:** 2026-04-11

## 개요

4개 파일. Sisyphus 메인 오케스트레이터의 모델별 프롬프트 변형. 부모 `sisyphus.ts`가 활성 모델에 따라 올바른 변형으로 라우팅한다.

## 파일

| 파일 | 목적 |
|------|---------|
| `default.ts` | 기본/Claude 변형: 작업 관리, 위임 가이드, 542 LOC |
| `gemini.ts` | Gemini 최적화: 더 엄격한 도구 사용 규칙, 5개 NEVER 규칙 |
| `gpt-5-4.ts` | GPT-5.4 네이티브: 8 블록 아키텍처, 엔트로피 감소, 449 LOC |
| `index.ts` | Barrel exports |

## 변형 선택

부모 `sisyphus.ts`가 모델 이름으로 변형을 선택:
- "gemini" 포함 -> `gemini.ts`
- "gpt-5.4" 포함 -> `gpt-5-4.ts`
- 기본 -> `default.ts` (Claude, Kimi, GLM 등)

## 주요 export

각 변형이 export하는 항목:
- `buildTaskManagementSection()` -- todo/task 관리 프롬프트
- `buildSisyphusPrompt()` 또는 동등한 항목 -- 전체 프롬프트 빌더
