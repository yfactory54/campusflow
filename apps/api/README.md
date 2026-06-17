# @campusflow/api

CampusFlow 모노레포의 백엔드 API 서버(`apps/api`)입니다. 외부 npm 의존성 없이 Node 내장 모듈만 사용합니다.

> 전체 실행(Docker Compose 등)은 저장소 루트의 [README](../../README.md)를 참고하세요. 아래는 백엔드 단독 실행 기준입니다.

- HTTP 서버: `node:http`
- 영구 저장: `node:sqlite` (파일 DB, **Node 22.9 이상 필요**)
- 인증/해싱: `node:crypto` (scrypt 비밀번호 해싱 + HMAC 서명 토큰)

```bash
# 권장: 저장소 루트에서 통합 .env 와 함께 실행
npm run dev:api    # (루트) 루트 .env 를 읽어 API 실행

# 또는 이 디렉터리에서 단독 실행
npm run api        # 서버 실행 (기본 http://localhost:4000)
npm run test:api   # 테스트 (인메모리 DB 사용)
```

## 환경 변수

설정은 **저장소 루트의 통합 [`.env`](../../.env.example)** 한 파일에서 관리합니다. 백엔드가 사용하는 값:

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `API_PORT` (또는 `PORT`) | `4000` | 서버 포트 |
| `DB_PATH` | `apps/api/data/app.db` | SQLite 파일 경로 |
| `TOKEN_SECRET` | (개발용 기본값) | 토큰 서명 비밀키. **운영에서는 반드시 설정** |
| `TOKEN_TTL_SECONDS` | `604800` (7일) | 토큰 만료 시간(초) |
| `CORS_ORIGIN` | (미설정 시 `*`) | 쉼표 구분 허용 Origin. 운영에서는 웹 도메인만 지정 |
| `ADMIN_EMAIL` / `ADMIN_NAME` | `admin@example.com` / `관리자` | 최초 시드 관리자 계정 |
| `ADMIN_PASSWORD` | (미설정 시 무작위 생성·로그) | 관리자 비밀번호(10자 이상, 영문/숫자/특수문자 중 2종류 이상) |
| `LOGIN_WINDOW_MS` / `LOGIN_MAX` | `900000` / `5` | 로그인 실패 제한 윈도와 최대 시도 횟수 |
| `LLM_BASE_URL` / `LLM_MODEL` / `LLM_TIMEOUT_MS` | 로컬 플레이스홀더 | AI 기여도 분석용 LLM 설정 |

## 데이터 / 시드

최초 실행 시 `DB_PATH`에 DB 파일이 생성되고, 비어 있으면 부트스트랩 관리자 계정만 시드됩니다(데모 회원·팀 없음).
데이터는 파일에 영구 저장되어 서버를 재시작해도 유지됩니다.

**초기 관리자 계정 — 비밀번호는 하드코딩하지 않습니다.**

| 구분 | 이메일(기본) | 비밀번호 | 권한 |
| --- | --- | --- | --- |
| 관리자 | `ADMIN_EMAIL` (기본 `admin@example.com`) | `ADMIN_PASSWORD` 또는 무작위 생성 후 로그에 1회 출력 | `admin` |

회원과 팀은 관리자로 로그인한 뒤 관리자 패널에서 직접 만듭니다.
무작위 생성 시 서버 시작 로그(`docker compose logs api` 또는 터미널)에 다음과 같이 1회만 표시됩니다.

```
════════ CampusFlow 초기 관리자 계정 (최초 1회만 표시) ════════
관리자 이메일: admin@example.com
관리자 비밀번호(자동 생성 — 지금 안전한 곳에 저장하세요): ●●●●●●●●
...
```

> 계정 생성은 관리자만 가능합니다(`POST /api/admin/users`). 자유 회원가입은 없습니다.

## 인증

- `POST /api/login` → `{ token, user }`. 이후 요청은 `Authorization: Bearer <token>` 헤더 필요.
- `GET /api/me` → 현재 사용자, `POST /api/logout` → 클라이언트가 토큰을 폐기(stateless), `POST /api/me/logout-all` → 모든 세션 무효화.
- 토큰에는 사용자별 `token_version`이 포함되어 비밀번호 초기화·역할/활성 변경 후 기존 토큰이 즉시 거부됩니다.
- 로그인 실패는 IP+email 기준 인메모리 rate limit으로 제한됩니다. 다중 인스턴스 운영 시 Redis 등 공유 스토어로 교체해야 합니다.
- 역할: `admin` | `leader` | `member`. 관리자는 모든 팀/업무에 접근하고, 팀장은 팀(방)을 생성할 수 있으며, 회원/팀장은 자신이 속한 방에서만 동작합니다.
- `GET /api/rooms` 는 역할별로 스코프됩니다(회원·팀장=소속 방만, 관리자=전체). `POST /api/rooms`(팀 생성)는 관리자·팀장만 가능합니다.
- 업무 등록 시 담당자는 **로그인 세션 사용자 이름으로 서버에서 자동 지정**되며 클라이언트 입력은 무시됩니다. 담당자 재배정은 관리자·팀장만 `assigneeId`로 요청할 수 있습니다.

## 주요 엔드포인트

| 메서드 | 경로 | 권한 |
| --- | --- | --- |
| `GET` | `/api/health` | 공개 |
| `POST` | `/api/login` | 공개 |
| `GET` | `/api/me` / `POST /api/logout` | 인증 |
| `POST` | `/api/me/logout-all` · `/api/me/password` | 인증 |
| `GET` | `/api/users/search?q=` | 관리자·팀장 (`id`, `name`만 반환) |
| `GET` | `/api/rooms` | 인증 (회원·팀장=소속 방만, 관리자=전체) |
| `POST` | `/api/rooms` | 관리자·팀장 (팀 생성) |
| `PATCH/DELETE` | `/api/rooms/:id` | 관리자·팀장·방 생성자 |
| `GET` | `/api/rooms/:id/members` | 회원(소속) 또는 관리자 |
| `POST/DELETE` | `/api/rooms/:id/members[/:userId]` | 관리자·팀장·방 생성자 |
| `GET/POST/PATCH/DELETE` | `/api/rooms/:id/tasks[/:taskId]` | 회원(소속) 또는 관리자 |
| `POST` | `/api/rooms/:id/contribution` | 회원(소속) 또는 관리자 |
| `GET` | `/api/rooms/:id/stats` | 회원(소속) 또는 관리자 |
| `GET/POST/DELETE` | `/api/rooms/:id/tasks/:taskId/comments[/:commentId]` | 회원(소속) 또는 관리자 |
| `GET` | `/api/me/notifications?unread=1` | 인증 |
| `POST` | `/api/me/notifications/:id/read` · `/api/me/notifications/read-all` | 인증 |
| `GET/POST` | `/api/admin/users` | 관리자 |
| `POST` | `/api/admin/users/:id/reset-password` | 관리자 |
| `PATCH` | `/api/admin/users/:id/role` · `/active` | 관리자 |
| `POST` | `/api/admin/users/:id/logout-all` | 관리자 |
| `GET` | `/api/admin/audit` | 관리자 |
| `GET` | `/api/admin/stats` | 관리자 |
| `GET` | `/api/admin/export/tasks.csv` · `/api/admin/export/users.csv` | 관리자 |
