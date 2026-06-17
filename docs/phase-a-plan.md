# Phase A — 권한 범위 축소 & 실패 처리

> **목표:** 운영 환경에서 가장 위험한 두 문제(권한 과대·로컬 상태 불일치)를 제거한다.
> **전제:** Phase 1 완료(실제 인증·SQLite·관리자 패널·담당자 자동지정). 상위 문서: `docs/phase2-plan.md`.
> **완료일:** 2026-06-17.
> **권장 진행 순서:** A-3 선결 작업(`useFetch`) → A-1 → A-2 → A-3 본작업.

---

## A-1. `/api/users` 정보 노출 축소

### 문제
모든 인증 사용자가 전체 사용자의 `email`·`role`·`isActive`·`createdAt`까지 조회할 수 있다.
- 근거: `apps/api/server.js:475`
- 사용처: `apps/web/src/components/TeamManager.tsx:64` ("추가 가능한 회원" 목록)

### 변경
1. **기존 `GET /api/users` 제거.** 전체 목록(role·active 포함)은 관리자 전용 `GET /api/admin/users`(`apps/api/server.js:226`)로 통일.
2. **신규 `GET /api/users/search?q=<문자열>`:**
   - 권한: `admin || leader` (멤버는 403).
   - 응답: `{ users: [{ id, name }] }` — 이메일·역할·활성 비노출.
   - 동작: q가 비어 있으면 빈 배열. 이름 부분일치(LIKE), 활성 사용자만, 상한 20명.
   - DB 함수 추가: `db.searchActiveUsersByName(q, limit)` (`apps/api/db.js`).
3. **프론트 변경:** `TeamManager` 초기 로드에서 `fetchUsers("users")` → `fetchUsers("users/search?q=")` 로 교체. 검색 입력란을 두고 q를 실시간으로 보낼지, 처음 일정 명만 보여줄지는 UX 결정. **최소 변경 권장:** 검색 입력란 추가, 빈 문자열일 때 빈 결과.

### 테스트
- `apps/api/server.test.js`에 추가:
  - 멤버 토큰으로 `/api/users/search?q=관` → 403.
  - leader 토큰으로 호출 → 200, 응답 객체에 `email`·`role`·`isActive` 키 부재 단언.
  - admin 토큰 호출 → 200.

---

## A-2. 팀원 추가/제거 권한 제한

### 문제
`assertRoomAccess`(`apps/api/server.js:518`)만 통과하면 방의 일반 멤버 누구나 팀원을 넣고 뺄 수 있다.
- 근거: `apps/api/server.js:553` (POST 추가), `apps/api/server.js:569` (DELETE 제거)

### 함정 — 방 생성자 컬럼 부재
`rooms` 테이블에 생성자 컬럼이 없다. `insertRoom`은 `creatorId`를 인자로 받지만 "생성자를 멤버로 추가"하는 데만 쓰고 저장하지 않는다(`apps/api/db.js:324`). "방 생성자만 허용"을 구현하려면 컬럼+마이그레이션이 선행돼야 한다.

### 변경 (백엔드)
1. **스키마:** `rooms`에 `created_by INTEGER` 추가(NULL 허용 — 기존 행 대비).
   - `apps/api/db.js`의 `SCHEMA` 상수 갱신.
   - `migrateRoomsCreatedBy(db)` 함수 신설, `apps/api/db.js:186`의 `migrateUsersRole` 패턴 그대로:
     - `sqlite_master`에서 `rooms` 정의 조회 → `created_by` 미포함이면 `ALTER TABLE rooms ADD COLUMN created_by INTEGER` (rooms는 PK 그대로 둘 수 있으므로 `ALTER ADD`로 충분, users처럼 테이블 재생성 불필요).
   - `openDatabase`에서 `migrateUsersRole` 다음에 호출.
2. **`insertRoom`(`apps/api/db.js:324`):** `created_by`에 `creatorId` 실제 저장. `INSERT INTO rooms (name, description, created_at, created_by) VALUES (?, ?, ?, ?)`.
3. **`mapRoom`(`apps/api/db.js:81`):** 응답에 `createdBy: row.created_by ?? null` 추가.
4. **신규 가드 `assertRoomManage(db, room, user)`:** admin || leader || `room.createdBy === user.id` 이면 통과, 아니면 `ApiError(403, '팀원 관리 권한이 없습니다.')`. `apps/api/auth.js`에 추가하거나 `server.js` 상단 헬퍼로 둠.
5. **적용 지점:**
   - `POST /api/rooms/:id/members` (`server.js:553`)
   - `DELETE /api/rooms/:id/members/:userId` (`server.js:569`)
   - `PATCH /api/rooms/:id` (`server.js:522`)
   - `DELETE /api/rooms/:id` (`server.js:539`)
   - 모두 `assertRoomAccess` 직후에 `assertRoomManage(db, room, currentUser)` 추가.

### 변경 (프론트)
- `TeamManager`/`RoomList`에서 "제거"·"수정"·"삭제" 버튼을 사용자 권한·생성자 여부로 조건부 노출. (서버에서 차단되므로 노출 차단은 UX 차원.)
- `App.tsx`나 `Room` 조회 시 `room.createdBy`를 받아서 판단.

### 테스트
- 일반 member 토큰으로 자기 소속 방의 `POST /members` → 403.
- 방 생성자(member) 토큰으로 → 201.
- admin 토큰으로 임의 방에 → 201.

---

## A-3. 실패 시 로컬 상태 불일치 방지

### 문제
- `apps/web/src/components/TaskItem.tsx:62` — `deleteTask` API 결과와 무관하게 `dispatch({ type: 'DELETE_TASK' })` 실행.
- `apps/web/src/components/TaskItem.tsx:71` — `editTask` 성공 여부와 무관하게 `dispatch({ type: 'CHANGE_STATUS' })` 실행.
- `TaskEditForm` 등 다른 호출부도 동일 패턴 확인 필요.

### 선결 작업 — `useFetch` 성공/실패 신호 분리
- 근거: `apps/web/src/fetch/useFetch.tsx:55-69` — 204 성공도 `null`, 실패도 `null`을 반환해서 호출부가 구분 불가.
- **변경안 (권장):** `request`의 반환 타입을 `Promise<{ ok: true; data: T | null } | { ok: false; error: string }>`로 바꾼다.
  - 204: `{ ok: true, data: null }`
  - 200 with JSON: `{ ok: true, data }`
  - !response.ok: `{ ok: false, error: 메시지 }` (현재 catch 블록의 `setError` 동작은 유지)
  - 호출부는 `if (!res.ok) return;` 또는 `if (res.ok) dispatch(...)`로 분기.
- **대안:** 성공 시 boolean 반환 + 데이터는 `state.data`로 노출. 호환성을 위해 권장안을 채택.

### 호출부 수정
1. **TaskItem 삭제(`:62`):**
   ```ts
   const res = await deleteTask(`rooms/${currentRoomId}/tasks/${task.id}`, { method: "DELETE" });
   if (!res.ok) return; // setError가 이미 호출되어 메시지 표시
   dispatch({ type: "DELETE_TASK", payload: { id: task.id } });
   ```
2. **TaskItem 상태변경(`:71`):**
   ```ts
   const res = await editTask(`rooms/${currentRoomId}/tasks/${task.id}`, {
     method: "PATCH",
     body: { status: nextStatus },
   });
   if (!res.ok) return;
   dispatch({ type: "CHANGE_STATUS", payload: { id: task.id, status: nextStatus } });
   ```
3. **`TaskForm`, `TaskEditForm`, `RoomList`, `TeamManager`, `AdminPanel`:** 동일 패턴 일괄 점검 — 모든 mutation 후 dispatch/setState가 있는 지점.
4. **에러 메시지 표시:** 각 컴포넌트가 이미 `useFetch.error`를 노출하면 그걸 활용. 없으면 토스트/인라인 메시지를 추가 — 이번 단계에선 인라인 메시지 최소 구현.

### 회귀 점검
- 모든 호출부가 새 반환 타입을 안전하게 처리하는지 TypeScript로 확인 (`npm run lint`/`tsc -b`).
- 정상 흐름 E2E: 로그인 → 업무 생성 → 상태 토글 → 삭제, 모두 UI 갱신 정상.
- 실패 흐름 수동 검증: 네트워크 차단 상태에서 삭제 → 목록에서 즉시 사라지지 않고 에러 메시지 노출.

---

## 보너스 — D-2(AI 기여도 분석) 동반 처리 검토
변경 규모가 작고 신뢰도 이득이 커서 Phase A와 묶는 것을 권장.
- `apps/api/server.js:577`에서 클라이언트 `body.tasks` 대신 서버 `db.listTasks(roomId)` 사용 (함수 이미 존재, `apps/api/db.js:358`).
- LLM 실패 시 규칙 기반 점수 fallback(담당/완료 수 × 우선순위 가중치)으로 502 대신 결과 반환.
- `apps/web/src/components/TeamManager.tsx:93`의 `body: { tasks }` 제거 (서버가 자체 조회).
- 자세한 설계는 Phase D 문서 참고 — 본 Phase 작업 중 함께 PR로 묶을지 결정.

---

## 검증 (Phase A 완료 기준)
1. `cd apps/api && npm test` — 신규 테스트 포함 전부 통과.
2. `npm run lint && npm run build` — 무경고/오류.
3. 수동 E2E:
   - member 토큰으로 `/api/users/search` → 403, `/api/users` → 404(라우트 제거).
   - 일반 member가 자기 방에서 다른 멤버 제거 시도 → 403, UI 버튼은 숨김.
   - 방 생성자(member)가 자기 방에서 추가/제거 → 정상.
   - 네트워크 오프라인 상태에서 업무 삭제 → 화면에서 사라지지 않음, 에러 메시지 노출, 다시 시도 가능.
4. README 로드맵 첫 미완 항목을 `[x]`로 옮기고 본 문서 상단에 완료일 추가.

## 주요 파일
- 백엔드: `apps/api/server.js`, `apps/api/db.js`, `apps/api/auth.js`, `apps/api/server.test.js`
- 프론트: `apps/web/src/fetch/useFetch.tsx`, `apps/web/src/components/{TaskItem,TaskEditForm,TaskForm,TeamManager,RoomList,AdminPanel}.tsx`
