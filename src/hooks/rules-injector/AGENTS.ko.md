# src/hooks/rules-injector/ — 조건부 규칙 주입

**생성일:** 2026-04-11

## 개요

19개 파일 (~1604 LOC). `rulesInjectorHook` — 디렉토리 내 파일이 read, write, edit될 때 AGENTS.md(및 유사 규칙 파일)를 컨텍스트에 자동 주입하는 Tool Guard 계층 훅. 근접도 기반: 타겟 경로에 가장 가까운 규칙 파일이 우선.

## 작동 방식

```
tool.execute.after (read/write/edit/multiedit)
  → 도구 출력에서 파일 경로 추출
  → 그 경로 근처의 규칙 파일 찾기 (finder.ts)
  → 이번 세션에 이미 주입했는가? (cache.ts)
  → 도구 출력에 규칙 콘텐츠 주입 (injector.ts)
```

## 추적 도구

`["read", "write", "edit", "multiedit"]` — 파일 조작 도구에서만 트리거.

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `hook.ts` | `createRulesInjectorHook()` — cache + injector 연결, 도구 이벤트 처리 |
| `injector.ts` | `createRuleInjectionProcessor()` — find → cache → inject 오케스트레이션 |
| `finder.ts` | `findRuleFiles()` + `calculateDistance()` — 타겟 경로 근처 AGENTS.md 위치 찾기 |
| `rule-file-finder.ts` | 디렉토리 트리 탐색하여 AGENTS.md / .rules 찾기 |
| `rule-file-scanner.ts` | 디렉토리에서 규칙 파일 스캔 |
| `matcher.ts` | 파일 경로를 규칙 파일 범위와 매칭 |
| `rule-distance.ts` | 파일과 규칙 파일 간 경로 거리 계산 |
| `project-root-finder.ts` | 프로젝트 루트 찾기 (.git, package.json에서 정지) |
| `output-path.ts` | 도구 출력 텍스트에서 파일 경로 추출 |
| `cache.ts` | `createSessionCacheStore()` — 세션별 주입 dedup |
| `storage.ts` | 도구 호출 사이에 주입된 경로 영속화 |
| `parser.ts` | 규칙 파일 콘텐츠 파싱 |
| `constants.ts` | 규칙 파일 이름: `AGENTS.md`, `.rules`, `CLAUDE.md` |
| `types.ts` | `RuleFile`, `InjectionResult`, `RuleFileScope` |

## 규칙 파일 발견

우선순위 (타겟 파일에 가까운 순 → 먼 순):
1. 타겟 파일과 같은 디렉토리
2. 프로젝트 루트까지의 부모 디렉토리들
3. 프로젝트 루트 자체

같은 거리 동률: 모두 주입. 세션별 dedup이 재주입을 방지.

## 절단

`DynamicTruncator` 사용 — 모델 컨텍스트 윈도우에 따라 주입 크기 적응 (1M 컨텍스트 모델은 전체 콘텐츠, 작은 모델은 절단된 요약).
