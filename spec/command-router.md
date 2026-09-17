# Command Router

## 목적
`index.ts`에 하드코딩돼 있던 switch-case를 없애고, 공용 명령어와 앱별 명령어를 등록식으로 관리한다. 새 앱(weedfinancial 등)이 명령어를 추가할 때 `index.ts`를 건드리지 않아도 되게 하는 것이 목표.

## 구조
- `src/core/types.ts` — `CommandContext`, `ModuleCommand`, `BotModule` 타입
- `src/core/router.ts` — `registerCoreCommand`, `registerModule`, `dispatch`, `buildHelpText`
- `src/core/commands.ts` — 공용 명령어(`!help`, `!clear`, `!model`)
- `src/modules/*.module.ts` — 앱별 모듈 (현재 `trendiv.module.ts`만 존재)

## 명명 규칙
- 공용 명령어: `!<name>` (네임스페이스 없음)
- 모듈 명령어: `!<모듈명> <서브커맨드> [args...]`
- 서브커맨드 조회는 대소문자 무시(`sub.toLowerCase()`로 조회)

## 새 모듈 추가 방법
1. `src/modules/<name>.module.ts` 생성, `BotModule` 객체 export
2. `src/index.ts`에 `registerModule(<name>Module)` 한 줄 추가
3. `index.ts`의 다른 부분은 건드리지 않는다

## 알려진 제약 (낮은 우선순위, 미해결)
- 긴 메시지(2000자) 분할 로직이 모듈마다 중복될 수 있음 — 공용 헬퍼로 뽑는 게 이상적이나 아직 안 함
- `!help` 텍스트에 길이 체크가 없음 — 등록된 모듈이 많아지면 2000자를 넘길 수 있음
- `coreCommands`(Map)와 `BotModule.commands`(Record)가 같은 모양의 데이터에 다른 자료구조를 씀

## 변경 이력
- 2026-09-17: 최초 구현 (PR #2, codex `gpt-6-astra`로 작성, Claude 리뷰)
- 2026-09-18: 서브커맨드 조회 시 대소문자 무시하도록 수정 (`!trendiv Done 5` 실패하던 버그, 코드리뷰로 발견)
