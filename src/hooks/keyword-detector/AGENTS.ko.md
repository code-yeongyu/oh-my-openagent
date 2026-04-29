# src/hooks/keyword-detector/ — 모드 키워드 주입

**생성일:** 2026-04-11

## 개요

8개 파일 + 3개 모드 서브디렉토리 (~1665 LOC). `messages.transform`의 Transform 계층 훅. 첫 사용자 메시지에서 모드 키워드(ultrawork, search, analyze)를 스캔하고 모드별 시스템 프롬프트를 주입.

## 키워드

| 키워드 | 패턴 | 효과 |
|---------|---------|--------|
| `ultrawork` / `ulw` | `/\b(ultrawork|ulw)\b/i` | 풀 오케스트레이션 모드 — 병렬 에이전트, 깊은 탐색, 끈질긴 실행 |
| Search 모드 | `SEARCH_PATTERN` (`search/`에서) | 웹/문서 검색 집중 프롬프트 주입 |
| Analyze 모드 | `ANALYZE_PATTERN` (`analyze/`에서) | 심층 분석 모드 프롬프트 주입 |

## 구조

```
keyword-detector/
├── index.ts           # 배럴 export
├── hook.ts            # createKeywordDetectorHook() — chat.message 핸들러
├── detector.ts        # detectKeywordsWithType() + extractPromptText()
├── constants.ts       # KEYWORD_DETECTORS 배열, 서브모듈에서 re-export
├── types.ts           # KeywordDetector, DetectedKeyword 타입
├── ultrawork/
│   ├── index.ts
│   ├── message.ts     # getUltraworkMessage() — 에이전트/모델별 동적 프롬프트
│   └── isPlannerAgent.ts
├── search/
│   ├── index.ts
│   ├── pattern.ts     # SEARCH_PATTERN 정규식
│   └── message.ts     # SEARCH_MESSAGE
└── analyze/
    ├── index.ts
    ├── pattern.ts     # ANALYZE_PATTERN 정규식
    └── message.ts     # ANALYZE_MESSAGE
```

## 감지 로직

```
chat.message (사용자 입력)
  → extractPromptText(parts)
  → isSystemDirective? → 스킵
  → removeSystemReminders(text)  # <SYSTEM_REMINDER> 블록 제거
  → detectKeywordsWithType(cleanText, agentName, modelID)
  → isPlannerAgent(agentName)? → ultrawork 필터링
  → 감지된 각 키워드에 대해: 모드 메시지를 출력에 주입
```

## 가드

- **시스템 지시 스킵**: 시스템 지시로 태깅된 메시지는 스캔하지 않음 (무한 루프 방지)
- **Planner 에이전트 필터**: Prometheus/plan 에이전트는 `ultrawork` 주입을 받지 않음
- **세션 에이전트 추적**: `getSessionAgent()`를 사용해 실제 에이전트 가져오기 (입력 힌트가 아님)
- **모델 인식 메시지**: `getUltraworkMessage(agentName, modelID)`가 활성 모델에 맞춰 메시지 적응
