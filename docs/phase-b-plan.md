# Phase B — 감사 로그 & CI

> **목표:** 누가 무엇을 언제 했는지 추적할 안전망을 깔고, 회귀를 자동으로 잡는 CI를 도입한다.
> **전제:** Phase A 완료(권한·실패 정합성). 상위 문서: `docs/phase2-plan.md`.
> **완료일:** 2026-06-17.

---

## B-1. 감사 로그 (Audit Log)

### 동기
- 운영 환경에서 권한·계정·업무 변경의 책임 추적이 필요.
- README 로드맵 미완 항목(`README.md:176`).
- 향후 Phase C(보안 사고 분석)·Phase D(통계 대시보드)의 입력 데이터로도 재사용 가능.

### 스키마 (`apps/api/db.js`)
```sql
CREATE TABLE IF NOT EXISTS audit_events (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER,                  -- 비로그인 이벤트(로그인 실패)에서는 NULL
  actor_name  TEXT NOT NULL DEFAULT '',
  actor_role  TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,            -- 'login.success' 등 점-구분 식별자
  target_type TEXT NOT NULL DEFAULT '', -- 'user' | 'room' | 'task' | ''
  target_id   TEXT NOT NULL DEFAULT '', -- 정수든 task-N 이든 문자열로 저장
  detail      TEXT NOT NULL DEFAULT '', -- JSON 직렬화한 추가 정보
  ip          TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_target  ON audit_events(target_type, target_id);
```
- 마이그레이션 불필요 — `IF NOT EXISTS` 로 신규 테이블만 추가.
- DB 함수: `db.insertAuditEvent({ actor, action, targetType, targetId, detail, ip })`, `db.listAuditEvents({ limit, offset, action, actorId, since })`.

### 이벤트 카탈로그 (action 식별자)
| action | 발생 지점 | target_type/id |
|---|---|---|
| `login.success` | `handleLogin` 성공 | user/{id} |
| `login.failure` | `handleLogin` 401 | user/{email — 익명일 수 있음} |
| `user.create` | `POST /api/admin/users` | user/{id} |
| `user.role.update` | `PATCH /api/admin/users/:id/role` | user/{id} |
| `user.active.update` | `PATCH /api/admin/users/:id/active` | user/{id} |
| `user.password.reset` | `POST /api/admin/users/:id/reset-password` | user/{id} |
| `room.create` / `room.update` / `room.delete` | `/api/rooms` POST/PATCH/DELETE | room/{id} |
| `room.member.add` / `room.member.remove` | `/api/rooms/:id/members` | room/{id}, detail.userId |
| `task.create` / `task.update` / `task.delete` | `/api/rooms/:id/tasks` | task/{id} |

### 코드 변경 패턴
- `apps/api/server.js`에서 mutation 직후 `db.insertAuditEvent(...)` 호출 — 동일 트랜잭션 안에 두지 않아도 무방하지만, 가능하면 `try`로 감싸 실패해도 본 응답에 영향 없게.
- `ip` 추출: `request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket.remoteAddress`.
- `detail`은 차분(diff) 중심으로 작게 유지(예: `{from:'member', to:'leader'}`). 비밀번호·토큰·해시는 절대 기록 금지.

### 관리자 조회 API & UI
- `GET /api/admin/audit?limit=&offset=&action=&actorId=&since=` — `requireAdmin`.
- 응답: `{ events: [...], total }` (총 개수는 페이지네이션용).
- `apps/web/src/components/AdminPanel.tsx`에 "감사 로그" 탭 추가:
  - 필터: 액션(드롭다운), 사용자, 기간.
  - 페이지네이션 10~50개 단위.
  - JSON `detail`은 펼침/접힘 토글로 노출.

### 테스트
- `apps/api/server.test.js`:
  - 로그인 성공/실패 시 이벤트가 정확한 action으로 1건 기록되는지.
  - 멤버 토큰으로 `/api/admin/audit` → 403.
  - 관리자 토큰으로 → 200 + 위에서 기록한 이벤트가 응답에 포함.
  - 비밀번호 초기화 시 `detail`에 비밀번호가 들어가지 않는지 단언.

### 운영 고려
- 보존 정책: 일단 무제한. 로그 테이블이 커지면 향후 별도 작업으로 90일 보존 cron 도입.
- 쓰기 부담: SQLite WAL 모드(`db.js`에서 이미 활성)면 단일 노드 운영 부하 충분히 흡수.

---

## B-2. GitHub Actions CI

### 동기
- 루트에 `lint`/`test`/`build` 스크립트가 이미 갖춰져 있어 도입 비용이 매우 낮다(`package.json`).
- README 로드맵 미완 항목.

### 파일 신설 — `.github/workflows/ci.yml`
```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
      - name: npm audit (high+)
        run: npm audit --audit-level=high
        continue-on-error: true   # 도입 초기 비차단. 안정화 후 제거.
```

### 옵션 — 보조 잡
- **scheduled audit:** 주 1회 cron으로 `npm audit` 실행 → 실패 시 Issue 자동 생성(actions/github-script).
- **빌드 산출물 검증:** `apps/web/dist`가 생성됐는지 확인하는 한 줄 단계.
- **Dependabot:** `.github/dependabot.yml` 추가로 npm·docker·gh-actions 주기 업데이트(작업량 적으면 분리해 별도 PR).

### 브랜치 보호
- GitHub 설정에서 `main`에 대해 "Require status checks to pass" → `build` 잡 필수 체크 지정. 본 작업의 최종 단계.

### 검증
- 본 워크플로가 첫 PR에서 통과하는지 확인.
- 의도적으로 lint 오류를 만들었을 때 CI가 실패하는지 한 번 시험.

---

## 검증 (Phase B 완료 기준)
1. 감사 로그 단위/통합 테스트 통과(`npm test`).
2. 관리자 UI에서 최근 이벤트가 시간 역순으로 표시되고, 필터·페이지네이션 동작.
3. 비밀번호/토큰/해시가 어느 이벤트 `detail`에도 들어가지 않음을 코드 리뷰로 확인.
4. CI가 PR에 자동으로 붙고 통과/실패가 GitHub 상태 체크로 보임.
5. README 로드맵 갱신.

## 주요 파일
- 백엔드: `apps/api/db.js`(스키마·함수), `apps/api/server.js`(이벤트 기록·관리자 라우트), `apps/api/server.test.js`
- 프론트: `apps/web/src/components/AdminPanel.tsx`(탭 추가)
- 운영: `.github/workflows/ci.yml`(신규), 선택적으로 `.github/dependabot.yml`
