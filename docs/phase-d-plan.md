# Phase D — 기능 확장

> **목표:** 보안·정합성 기반(A·B·C)이 갖춰진 위에서 사용자 가치를 키우는 기능을 추가한다.
> **전제:** Phase A·B·C 완료. 상위 문서: `docs/phase2-plan.md`.

각 항목은 독립적이며 우선순위(가치/구현비용비)는 D-2 > D-1 > D-4 > D-3 > D-5.
특히 **D-2(AI 기여도)는 변경 범위가 매우 작아 Phase A와 묶어 먼저 진행하는 것을 권장**(Phase A 문서 보너스 항목 참고).
> 구현 완료일: 2026-06-17.

---

## D-1. 통계 대시보드

### 동기
관리자/팀장이 진행 상황을 한눈에 보고 병목을 찾을 수 있게 한다. Phase B의 감사 로그를 부분적으로 재사용 가능.

### API
- `GET /api/admin/stats` (admin) — 전체 집계.
- `GET /api/rooms/:id/stats` (admin·leader·해당 방 멤버) — 방 단위 집계.
- 응답 예:
  ```json
  {
    "totalsByStatus": { "todo": 12, "inProgress": 5, "done": 30 },
    "completionRateByRoom": [ { "roomId": 1, "name": "팀A", "rate": 0.75 } ],
    "completionRateByUser": [ { "userId": 3, "name": "수민", "completed": 8, "total": 10 } ],
    "overdueTasks": [ { "id": "task-12", "roomId": 1, "title": "...", "dueDate": "2026-06-10" } ],
    "priorityDistribution": { "low": 5, "medium": 30, "high": 12 }
  }
  ```
- 모두 단일 SQL 집계로 가능 — `apps/api/db.js`에 `db.stats()`, `db.statsByRoom(roomId)` 추가.

### UI
- `AdminPanel`에 "통계" 탭. 카드형 위젯 + 막대그래프(외부 라이브러리 없이 SVG로 구현 또는 단순 표).
- 팀장에게는 헤더에서 자기 팀의 통계 진입 버튼 노출.

### 테스트
- 구현 완료: `GET /api/admin/stats`, `GET /api/rooms/:id/stats`, 관리자 "통계" 탭, CSV 내보내기 버튼과 함께 검증됨.
- 시드 데이터로 합계가 일치하는지 단언.

---

## D-2. AI 기여도 분석 고도화 (소규모·고가치 — Phase A와 묶기 권장)

### 문제 (이미 식별됨)
- `apps/api/server.js:577` — 클라이언트가 보낸 `body.tasks`를 그대로 분석에 사용. 변조 가능.
- LLM 실패 시 502만 반환 — 사용자 경험 단절.

### 변경
1. **서버에서 데이터 조회:**
   - `POST /api/rooms/:id/contribution` 핸들러에서 `db.listTasks(roomId)` 사용(`apps/api/db.js:358`에 이미 존재).
   - 클라이언트 입력은 받지 않음(또는 받아도 무시).
2. **규칙 기반 fallback:**
   - `computeContributionFallback(members, tasks)` 함수 신설.
   - 가중치 예: 완료 업무 × {high:3, medium:2, low:1}. 진행 중 ×0.5. 합산 후 0~100 정수로 정규화.
   - `assignedCount`/`completedCount`는 그대로 계산.
   - LLM 미설정(`LLM_BASE_URL` 기본값) 또는 호출 실패 시 fallback 결과 반환(응답 본문에 `source: 'fallback'` 표시).
3. **클라이언트:** `apps/web/src/components/TeamManager.tsx:93`의 `body: { tasks }` 제거. 결과 표시 영역에 `source === 'fallback'`이면 "규칙 기반 결과" 배지 표시.

### 테스트
- 구현 완료: 서버가 `db.listTasks(roomId)`만 사용하며, `LLM_BASE_URL` 미설정 또는 호출 실패 시 `source: "fallback"` 규칙 기반 결과를 200으로 반환한다.
- `LLM_BASE_URL` 미설정 환경에서 200 + fallback 결과.
- `db.listTasks` 결과 기반인지(요청 본문의 `tasks`는 무시되는지) 단언.

---

## D-3. 알림 (마감 임박 / 업무 배정)

### 동기
일정 누락을 줄인다. 인앱 → 이메일/Slack 순으로 확장.

### Phase D-3a — 인앱 알림 (MVP)
- 스키마: `notifications(id, user_id, kind, target_type, target_id, message, read_at, created_at)`.
- 생성 트리거:
  - 업무 생성/수정 시 담당자가 본인 외라면 알림 1건 — *현재 담당자 == 생성자이므로 D-4(담당자 재배정)와 함께 의미가 커짐.*
  - cron(노드 `setInterval` 또는 외부 스케줄러)로 `dueDate <= today + 1d && status != 'done'` 업무에 대해 미발송 알림 생성.
- API:
  - `GET /api/me/notifications?unread=1`
  - `POST /api/me/notifications/:id/read`
  - `POST /api/me/notifications/read-all`
- UI: 헤더에 종 아이콘 + 미읽음 카운트 배지 + 드롭다운.

- 구현 완료: `notifications` 테이블, 배정/마감 임박 인앱 알림, 헤더 드롭다운, 개별/전체 읽음 API를 추가했다.
### Phase D-3b — 외부 채널 (후속)
- 이메일: 환경변수 `SMTP_*`. 사용자 알림 설정(테이블 `notification_prefs`).
- Slack Incoming Webhook: 팀 단위 채널 설정.
- 본 단계는 인앱 안정화 후 별도 PR로 분리.

---

## D-4. 업무 담당자 재배정

### 문제
담당자는 생성자로 고정(Phase 1의 의도였지만, 실제 협업에서는 재배정 필요).
- 현재: `apps/api/server.js:118`에서 `assignee = currentUser.name`, `buildTaskUpdate`(`apps/api/server.js:144`)에서 `assignee` 무시.

### 변경
- `buildTaskUpdate`에 `assignee` 분기 추가. **권한:** admin || leader || 현재 담당자 == currentUser.name || 업무 생성자 — `tasks` 테이블에 `created_by` 컬럼 추가가 필요할 수 있음(없으면 admin/leader만).
- 더 단순한 안: **admin·leader만 재배정 가능**. 일반 멤버는 본인 업무를 다른 멤버에게 양도하려면 admin/leader에게 요청.
- 입력 형식: `assignee`를 사용자 이름이 아닌 `assigneeId`로 변경하는 것을 권장(이름 충돌 회피). DB의 `tasks.assignee` 컬럼은 후방호환 위해 유지하되, 별도 `assignee_id INTEGER` 컬럼 추가 + 마이그레이션 — *변경 영향 크므로 별도 작은 PR로 분리.*

### UI
- `TaskItem`/`TaskEditForm`에 admin·leader일 때 담당자 드롭다운 노출(팀원 목록에서 선택).

### 테스트
- 멤버 토큰으로 재배정 시도 → 403.
- leader 토큰으로 재배정 → 200.
- 감사 로그에 `task.assignee.update` 기록.
- 구현 완료: admin·leader만 `assigneeId`로 재배정 가능하며 직접 `assignee` 문자열 변경은 거부한다. 재배정은 감사 로그와 배정 알림을 생성한다.

---

## D-5. 부가 기능 (보고·협업)

### D-5a. 댓글 / 활동 히스토리
- 스키마: `task_comments(id, task_id, author_id, body, created_at)`.
- API: `GET/POST /api/rooms/:roomId/tasks/:taskId/comments`, `DELETE` (작성자·admin).
- UI: `TaskItem` 펼침 영역에 댓글 스레드.
- 활동 히스토리는 Phase B의 감사 로그를 task 단위로 필터해 그대로 보여주면 별도 테이블 없이 구현 가능.

### D-5b. CSV 내보내기
- `GET /api/admin/export/tasks.csv`, `GET /api/admin/export/users.csv` — admin 전용.
- Node 표준 라이브러리만으로 가능(`response.setHeader('content-type', 'text/csv; charset=utf-8')`).
- 컬럼은 운영 보고에서 흔히 쓰는 키만(개인정보 최소화). 비밀번호/해시는 절대 미포함.
- 구현 완료: 업무 댓글 API/UI와 관리자 `tasks.csv`·`users.csv` 내보내기를 추가했다.

---

## 우선순위 권장 묶음 (PR 단위)

1. **PR-1 (Phase A와 동반):** D-2 AI 기여도 서버 데이터화 + fallback.
2. **PR-2:** D-1 통계 대시보드 — 가시적 가치 큼.
3. **PR-3:** D-4 담당자 재배정(우선 admin·leader 한정 단순안) — D-3·D-5의 전제가 됨.
4. **PR-4:** D-3a 인앱 알림.
5. **PR-5:** D-5 댓글·CSV(독립적이므로 시간 여유 시).
6. **PR-6+:** D-3b 외부 채널 알림.

## 검증 (Phase D 단위 완료 기준)
- 각 PR마다 단위/통합 테스트 작성 + 수동 E2E.
- 감사 로그에 새 mutation이 모두 기록되는지 점검(Phase B의 후속 작업).
- README 로드맵에서 완료된 항목을 `[x]`로 이관.

## 주요 파일 (전 항목 합산)
- 백엔드: `apps/api/server.js`, `apps/api/db.js`, `apps/api/auth.js`, `apps/api/server.test.js`
- 프론트: `apps/web/src/components/{AdminPanel,TeamManager,TaskItem,TaskEditForm,Header}.tsx`, `apps/web/src/App.tsx`
- 신규 컴포넌트(예상): `apps/web/src/components/{StatsPanel,NotificationBell,TaskComments}.tsx`
