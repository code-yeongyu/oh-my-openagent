# src/cli/doctor/ — 헬스 진단 (25개 체크 파일)

**생성일:** 2026-04-18

## 개요

`bunx oh-my-opencode doctor` — 4개 카테고리(System, Config, Tools, Models)에 걸친 병렬 진단 체크. 깨진 설치, 설정 오타, 누락된 의존성, 프로바이더 잘못된 구성을 런타임 오류가 되기 전에 잡아냄.

## 명령 플래그

```bash
bunx oh-my-opencode doctor              # 전체 진단 (4개 카테고리 모두)
bunx oh-my-opencode doctor --status     # 컴팩트 대시보드 (상태만)
bunx oh-my-opencode doctor --verbose    # 상세 정보 (모델 해석 trace)
bunx oh-my-opencode doctor --json       # 머신 가독 출력
```

## 체크 카테고리

| 카테고리 | 파일 | 검증 대상 |
|----------|------|-----------|
| **SYSTEM** | `checks/system.ts` | OpenCode 바이너리 존재 + 버전 ≥1.0.150, opencode.json에 플러그인 등록, 로드된 플러그인 버전이 설치본과 일치 |
| **CONFIG** | `checks/config.ts` | JSONC 유효성, Zod 스키마 통과, 알 수 없는 키 없음, 모델 오버라이드 문법 정확성 |
| **TOOLS** | `checks/tools.ts` | AST-Grep CLI + NAPI, comment-checker 바이너리, LSP 서버 도달 가능성, GitHub CLI 인증, 빌트인 MCP 도달 가능성 |
| **MODELS** | `checks/model-resolution.ts` | models.json 캐시 존재, 에이전트별 fallback 해석, 카테고리 오버라이드 유효성, 프로바이더 가용성 |

## 보조 체크 파일 (총 25개)

```
checks/
├── index.ts                               # 등록
├── system.ts                              # 메인 System 집계자
├── system-binary.ts                       # OpenCode 바이너리 검색 (PATH + 데스크톱 앱)
├── system-plugin.ts                       # opencode.json 플러그인 항목 감지
├── system-loaded-version.ts               # 캐시 vs npm latest
├── config.ts                              # 메인 Config 집계자
├── tools.ts                               # 메인 Tools 집계자
├── dependencies.ts                        # AST-Grep CLI/NAPI + comment-checker 존재 여부
├── tools-gh.ts                            # gh cli 설치 + 인증 상태
├── tools-lsp.ts                           # LSP 서버 열거
├── tools-mcp.ts                           # 빌트인 + 사용자 MCP 도달 가능성
├── model-resolution.ts                    # 메인 Models 집계자
├── model-resolution-cache.ts              # models.json 존재 여부 + 신선도
├── model-resolution-config.ts             # oh-my-opencode.jsonc 파싱
├── model-resolution-effective-model.ts    # 에이전트별 fallback chain trace
├── model-resolution-variant.ts            # 모델 variant (max, high, medium) 처리
├── model-resolution-details.ts            # Verbose 출력 포매터
└── model-resolution-types.ts              # 공유 타입
```

## 실행 흐름

```
doctor command
  → runner.ts: 체크당 30초 타임아웃의 병렬 체크 실행
  → checks/index.ts가 4개 카테고리 체크 모두 등록
  → 각 체크는 다음 반환: { status: "ok" | "warn" | "error", detail: string }
  → formatter.ts: stdout으로 렌더 (text/status/json)
  → exit code: 0 (모두 ok) | 1 (에러) | 2 (경고만)
```

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `index.ts` | CLI 명령 진입점, 플래그 파싱 |
| `runner.ts` | 병렬 `Promise.allSettled()` 오케스트레이션, 체크당 30초 타임아웃 |
| `formatter.ts` | Pretty 프린팅: 색상 상태, 계층적 출력 |
| `types.ts` | `DoctorCheck`, `CheckResult`, `DoctorReport` 타입 |

## 체크 추가 방법

1. `src/cli/doctor/checks/{name}.ts` 생성, `DoctorCheck`에 부합하는 체크 함수 export
2. `checks/index.ts`에 등록
3. 카테고리 레벨 집계자(system/config/tools/model-resolution)가 호출함
4. `{ status, detail }` 반환 — throw 금지, 모든 에러는 runner에서 catch

## Exit 코드

- `0`: 모든 체크 통과 (또는 정보 메시지만)
- `1`: 하나 이상의 에러 — 플러그인이 동작하지 않을 가능성 높음
- `2`: 경고만 — 일부 기능이 저하된 상태로 플러그인 동작
