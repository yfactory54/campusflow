# CampusFlow Phase 2 개선 계획

> 코드 리뷰 피드백 기반 상용화 후속 개선안. Phase 1(실제 인증·SQLite·관리자 패널·담당자 자동지정·배포)은 완료된 상태이며, 본 문서는 그 위에 얹는 보안·정합성·기능 강화 로드맵이다.
> 작성일: 2026-06-17. Phase 1 전체 계획은 `~/.claude/plans/glowing-wishing-charm.md` 참고.

## 배경: 리뷰와 현재 코드의 차이

리뷰 지적사항 중 일부는 이미 반영되어 있고, 구현 전 알아둬야 할 함정이 둘 있다.

- **이미 반영됨:** 역할 3단계(admin/leader/member). 팀 생성은 admin·leader만(`apps/api/server.js:500`). 방 목록은 소속 방만 노출(`listRoomsForUser`). 배포·스키마 마이그레이션은 README 로드맵에서 완료 표시.
- **함정 1 — 방 생성자 컬럼 부재:** `rooms` 테이블에 생성자 컬럼이 없다. `insertRoom`은 `creatorId`를 받지만 "생성자를 멤버로 추가"하는 데만 쓰고 저장하지 않는다(`apps/api/db.js:324`). "방 생성자만 허용" 정책은 `created_by` 컬럼 + 마이그레이션이 선행돼야 한다.
- **함정 2 — useFetch가 성공/실패를 구분 못 함:** DELETE 성공(204)과 실패가 둘 다 `null`을 반환한다(`apps/web/src/fetch/useFetch.tsx:55-69`). "성공 시에만 dispatch"하려면 useFetch가 성공/실패를 구분해 반환하도록 먼저 고쳐야 한다(Phase A-3의 선결 조건).

---

## Phase A — 권한 범위 축소 & 실패 처리 (최우선)

### A-1. `/api/users` 정보 노출 축소
- **근거:** `apps/api/server.js:475` — 모든 인증 사용자가 전체 사용자의 email·role·isActive·createdAt까지 조회. `apps/web/src/components/TeamManager.tsx:64`에서 "추가 가능한 회원"에 사용.
- **변경:**
  - 전체 목록(role·active 포함)은 **관리자 전용**으로 유지 → 기존 `/api/admin/users`(`apps/api/server.js:226`) 사용.
  - 팀원 초대용 신규 `GET /api/users/search?q=` — **`{id, name}`만** 반환(이메일·역할·활성 비노출), 권한은 admin·leader.
  - `TeamManager`가 새 검색 API를 사용하도록 변경.

### A-2. 팀원 추가/제거 권한 제한
- **근거:** `apps/api/server.js:553`, `apps/api/server.js:569` — `assertRoomAccess`(`server.js:518`)만 통과하면 방의 일반 멤버 누구나 팀원 추가/제거 가능.
- **변경:**
  - `rooms`에 `created_by INTEGER` 컬럼 추가 + `migrateRoomsCreatedBy()` 마이그레이션(`apps/api/db.js:186`의 `migrateUsersRole` 패턴 재사용). `insertRoom`이 값을 실제 저장하도록 수정(`db.js:324`).
  - `assertRoomManage` 가드 추가: **admin || leader || room.created_by === user.id** 만 허용. 멤버 추가/제거 + 방 수정/삭제(PATCH/DELETE `server.js:522`, `server.js:539`)에 적용.

### A-3. 실패 시 로컬 상태 불일치 방지
- **근거:** `apps/web/src/components/TaskItem.tsx:62`(삭제), `:71`(상태변경) — API 결과와 무관하게 `dispatch` 실행. `TaskEditForm`도 점검.
- **선결 작업:** `apps/web/src/fetch/useFetch.tsx`가 성공/실패를 구분해 반환하도록 수정(204 성공도 `null`이라 현재 구분 불가). `request`가 `{ ok, data }`를 반환하거나 성공/실패 신호를 명확히 줄 것.
- **변경:** 응답 성공일 때만 `dispatch`, 실패 시 메시지 노출 또는 목록 재조회로 복구. 낙관적 업데이트 사용 시 실패 롤백.

## Phase B — 감사 로그 & CI (추적성)

### B-1. 감사 로그
- **근거:** `README.md:176` 미완 항목.
- **변경:**
  - `audit_events(id, actor_id, actor_name, action, target_type, target_id, detail, created_at)` 테이블 + `db.insertAuditEvent` / `listAuditEvents(limit, offset)`.
  - 기록 지점: 로그인 성공/실패, 계정 생성, 역할 변경, 활성/비활성, 비번 초기화, 방 생성·수정·삭제, 팀원 추가·제거, 업무 생성·수정·삭제.
  - 관리자 전용 `GET /api/admin/audit`(페이지네이션) + `AdminPanel` 탭.

### B-2. GitHub Actions CI
- **근거:** 루트에 `lint`/`test`/`build` 스크립트 존재(`package.json`). lint는 `eslint .`(web).
- **변경:** `.github/workflows/ci.yml` — Node 22, `npm ci` → `npm run lint` → `npm test` → `npm run build` → `npm audit --audit-level=high`(audit 비차단 옵션 검토). PR·push 트리거.

## Phase C — 운영 보안 강화

- **로그인 시도 제한:** 무의존성 인메모리 Map(IP+email 키, 예: 15분 5회)으로 `handleLogin`(`server.js:195`) 앞단 차단. *주의: 단일 프로세스 기준 — 다중 인스턴스면 공유 스토어 필요.*
- **세션 무효화:** stateless 토큰은 개별 폐기 불가(`apps/web/src/App.tsx:50` 로그아웃은 best-effort). `users.token_version` 컬럼 추가 → 토큰 payload에 포함, `requireAuth`에서 대조. 비번 초기화·비활성화·역할 변경·"모든 기기 로그아웃" 시 version 증가로 기존 토큰 일괄 무효화.
- **비밀번호 정책:** 최소 길이 상향 + 복잡도 검증을 admin 계정 생성(`server.js:243`)·비번 초기화(`server.js:276`)에 공통 함수로 적용.
- **CORS 제한:** `server.js:31`의 `origin: *`를 `CORS_ORIGIN` 환경변수 허용목록으로 교체.
- **nginx 보안 헤더:** `apps/web/nginx.conf`에 HSTS·X-Content-Type-Options·X-Frame-Options·Referrer-Policy·CSP 추가.

## Phase D — 기능 확장 *(2026-06-17 완료)*

1. **통계 대시보드** — `GET /api/admin/stats`, `GET /api/rooms/:id/stats`, 관리자 통계 탭으로 팀별 완료율·사용자별 처리량·지연 업무·우선순위 분포 제공.
2. **AI 기여도 분석 고도화:** 클라이언트 `body.tasks`를 무시하고 서버 `db.listTasks(roomId)`만 사용. LLM 미설정/실패 시 규칙 기반 점수 fallback(`source: "fallback"`) 반환.
3. **알림** — 인앱 알림으로 업무 배정과 마감 임박 알림 제공, 개별/전체 읽음 API와 헤더 드롭다운 추가.
4. **업무 담당자 재배정** — admin/leader 한정 `assigneeId` 기반 재배정, 직접 이름 문자열 변경 거부, 감사 로그 기록.
5. **댓글/CSV** — 업무 댓글 스레드와 관리자 `tasks.csv`·`users.csv` 내보내기 제공.

---

## 권장 진행 순서

```
A (권한·실패처리)  →  B (감사로그·CI)  →  C (운영보안)  →  D (기능)
   보안/정합성          추적성             하드닝          가치
```

가장 먼저: A-3의 `useFetch` 수정(데이터 정합성 토대) + A-1/A-2 권한 축소. 이어 B로 안전망을 깐 뒤 C·D 진행 시 회귀 위험이 가장 낮다. D-2(AI 기여도)는 규모가 작고 이득이 커서 Phase A와 함께 끼워 넣어도 좋다.

## 주요 파일

- 백엔드: `apps/api/server.js`, `apps/api/db.js`, `apps/api/auth.js`, `apps/api/server.test.js`
- 프론트: `apps/web/src/fetch/useFetch.tsx`, `apps/web/src/components/{TaskItem,TaskEditForm,TeamManager,AdminPanel}.tsx`
- 운영: `apps/web/nginx.conf`, `.github/workflows/ci.yml`(신규)
