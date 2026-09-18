# Command Router

## 목적
`index.ts`에 하드코딩돼 있던 switch-case를 없애고, 공용 명령어와 앱별 명령어를 등록식으로 관리한다. 새 앱(weedfinancial 등)이 명령어를 추가할 때 `index.ts`를 건드리지 않아도 되게 하는 것이 목표.

## 구조
- `src/core/types.ts` — `CommandContext`, `ModuleCommand`, `BotModule` 타입
- `src/core/router.ts` — `registerCoreCommand`, `registerModule`, `dispatch`, `buildHelpLines`
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

## 긴 메시지 처리
`src/core/discord.util.ts`의 `sendChunked(channel, lines)`가 공용 헬퍼. 줄 배열을 받아 `\n`으로 합친 전체 길이가 2000자 이내면 한 번에, 넘으면 순서를 유지하며 2000자 이내로 최대한 묶어(배치) 여러 메시지로 나눠 보낸다(한 줄씩 스팸처럼 보내지 않음). `!help`(`buildHelpLines()`)와 모듈 서브커맨드 도움말(`dispatch()`의 fallback), `trendiv list` 전부 이걸 통해서 보낸다. 한 줄 자체가 2000자를 넘는 경우는 그 줄만 단독 전송(그래도 실패할 수 있는 이론적 엣지케이스지만, 현재 명령어 설명 길이로는 발생 안 함).

## 알려진 제약 (낮은 우선순위, 미해결)
- 없음 — 이전에 있던 두 항목(자료구조 불일치, 메시지 분할)은 각각 PR #4, 2026-09-19 정리에서 해결됨

## 변경 이력
- 2026-09-17: 최초 구현 (PR #2, codex `gpt-6-astra`로 작성, Claude 리뷰)
- 2026-09-18: 서브커맨드 조회 시 대소문자 무시하도록 수정 (`!trendiv Done 5` 실패하던 버그, 코드리뷰로 발견)
- 2026-09-18: `coreCommands`를 Map에서 Record로 통일, `sendChunked` 헬퍼 최초 추출 (PR #4)
- 2026-09-19: `sendChunked`를 진짜 배치 패킹 방식으로 재설계(`!help`가 길어지면 한 줄씩 스팸 대신 몇 개로 묶어서 전송), 모듈 도움말 fallback 경로도 같은 헬퍼로 통일 (야간 자율 작업, 코드리뷰로 발견한 문제들 반영)
