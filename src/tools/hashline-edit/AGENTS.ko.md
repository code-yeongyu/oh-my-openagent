# src/tools/hashline-edit/ — 해시 앵커링된 파일 편집 도구

**생성일:** 2026-04-11

## 개요

24개 파일. `hashline_edit` 도구 구현 — 모든 라인 참조에 콘텐츠 해시(`LINE#ID`)가 포함된 해시 앵커링 파일 편집. 편집 적용 전에 해시를 검증하여 오래된 참조를 거부.

## 3-OP 모델

모든 편집은 정확히 3개의 연산을 사용:

| Op | pos | end | lines | 효과 |
|----|-----|-----|-------|--------|
| `replace` | 필수 | 선택 | 필수 | 단일 라인 또는 pos..end 범위 교체 |
| `append` | 선택 | 선택 | 필수 | 앵커 뒤에 삽입 (앵커 없으면 EOF) |
| `prepend` | 선택 | 선택 | 필수 | 앵커 앞에 삽입 (앵커 없으면 BOF) |

`replace`에 `lines: null` 또는 `lines: []` = 삭제. 도구 레벨의 `delete: true` = 파일 삭제.

## 실행 파이프라인

```
hashline-edit-executor.ts
  → normalize-edits.ts       # RawHashlineEdit → HashlineEdit 파싱 (op 스키마 검증)
  → validation.ts            # LINE#ID 참조 검증 (해시 일치, 라인 존재)
  → edit-ordering.ts         # 아래에서 위로 정렬 (라인 번호 내림차순)
  → edit-deduplication.ts    # 중복 op 제거
  → edit-operations.ts       # edit-operation-primitives.ts를 사용하여 각 op 적용
  → autocorrect-replacement-lines.ts  # 들여쓰기/포매팅 자동 수정
  → hashline-edit-diff.ts    # diff-utils.ts로 diff 출력 빌드
```

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `tools.ts` | `createHashlineEditTool()` 팩토리 — 도구 스키마 + 진입점 |
| `hashline-edit-executor.ts` | 메인 실행: normalize → validate → order → apply → diff |
| `normalize-edits.ts` | `RawHashlineEdit[]` 파싱 (문자열 `op` 변형 허용) → 타입화된 `HashlineEdit[]` |
| `validation.ts` | LINE#ID 검증: 해시 파싱, 라인 콘텐츠가 저장된 해시와 일치하는지 검증 |
| `hash-computation.ts` | `computeLineHash(line)` → `ZPMQVRWSNKTXJBYH` 집합에서 2자 CID |
| `edit-operations.ts` | replace/append/prepend를 파일 라인 배열에 적용 |
| `edit-operation-primitives.ts` | 저수준 라인 배열 변경 프리미티브 |
| `edit-ordering.ts` | 다중 편집 시 라인 번호 보존을 위해 아래에서 위로 정렬 |
| `edit-deduplication.ts` | 겹치거나 동일한 연산 제거 |
| `edit-text-normalization.ts` | 라인 콘텐츠 정규화 (CRLF, BOM, 끝부분 공백) |
| `file-text-canonicalization.ts` | 해싱 전 전체 파일 콘텐츠 정규화 |
| `autocorrect-replacement-lines.ts` | 원본 라인의 들여쓰기 자동 복원 |
| `hashline-edit-diff.ts` | 에러/성공 메시지를 위한 통합 diff 생성 |
| `diff-utils.ts` | `diff` npm 라이브러리의 얇은 래퍼 |
| `hashline-chunk-formatter.ts` | `LINE#ID` 태그로 라인 청크 포맷 |
| `tool-description.ts` | `HASHLINE_EDIT_DESCRIPTION` 상수 |
| `types.ts` | `HashlineEdit`, `ReplaceEdit`, `AppendEdit`, `PrependEdit` |
| `constants.ts` | 해시 알파벳, 구분 문자 (`#`), 파이프 구분 (`|`) |

## LINE#ID 형식

```
{line_number}#{hash_id}
```

- `hash_id`: `ZPMQVRWSNKTXJBYH` (CID 문자)에서 두 글자
- 예: `42#VK`는 해시 `VK`를 가진 라인 42를 의미
- 검증: 현재 라인 콘텐츠의 해시를 다시 계산 → 저장된 해시와 일치해야 함
- 콘텐츠 구분자: 읽기 출력에서 해시 태그와 콘텐츠 사이의 `|` (파이프)

## 자동 수정 동작 (내장)

- 합쳐진 라인은 원본 개수로 자동 재확장
- 원본 라인의 들여쓰기 복원
- BOM 및 CRLF 줄바꿈 보존
- `lines` 텍스트의 `>>>` 접두사와 diff 마커 자동 제거

## 에러 케이스

- 해시 불일치 → 편집 거부, 현재 상태와 함께 diff 표시
- 겹치는 범위 → 감지 및 거부
- `replace`에 `pos` 누락 → 스키마 에러
- `append`/`prepend`에 `lines: null` → 스키마 에러

## 라인 해시 작동 방식

```typescript
// 읽기: 모든 라인이 태깅됨
"42#VK| function hello() {"

// 편집: 태그로 참조
{ op: "replace", pos: "42#VK", lines: "function hello(name: string) {" }

// 읽기 이후 파일이 변경되었다면: 해시가 일치하지 않음 → 손상 전에 거부
```
