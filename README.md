# CampusFlow — 팀 업무 관리 협업 툴

> 로그인·권한 기반의 팀 단위 업무(Task) 관리와 **AI 기여도 분석**을 제공하는 풀스택 협업 애플리케이션

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.9-339933?logo=nodedotjs&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003B57?logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## 📖 소개

CampusFlow는 팀(방)을 만들고 팀원을 초대하여 업무를 등록·진행·완료까지 관리하는 협업 도구입니다.
**외부 npm 의존성 없이** Node.js 내장 모듈(`node:http`, `node:sqlite`, `node:crypto`)만으로 동작하는 경량 백엔드와,
React 19 + TypeScript + Vite 기반의 SPA 프론트엔드로 구성된 **모노레포**입니다.

- 🔐 실제 인증(scrypt 해싱 + 서명 토큰)과 **3단계 역할**(관리자 / 팀장 / 회원) 권한 체계
- 👥 팀 단위 협업 — 권한 없는 팀은 목록에 노출되지 않고, 팀 생성은 **관리자·팀장만** 가능
- ✅ 업무(Task) 등록·수정·상태 전환·검색/필터/정렬 — 담당자는 로그인 사용자로 서버가 자동 지정
- 💾 SQLite 파일 DB 기반 영구 저장(서버 재시작에도 데이터 유지) + 스키마 자동 마이그레이션
- 🛠️ 관리자 패널 — 계정 생성·역할 변경·비밀번호 초기화·활성화 + 전체 팀·업무 관리
- 🤖 LLM 기반 팀원별 기여도 분석

## 👥 권한 체계

역할은 **관리자가 관리자 패널에서 부여**합니다(자유 회원가입 없음).

| 역할 | 설명 | 주요 권한 |
| --- | --- | --- |
| **관리자** `admin` | 시스템 전체 관리 | 모든 팀·업무 접근, 계정 생성·역할 변경·비번 초기화·활성화, 전체 팀·업무 관리 |
| **팀장** `leader` | 팀 생성 권한 보유 | 팀(방) 생성, 자신이 속한 팀의 업무·팀원 관리 |
| **회원** `member` | 일반 사용자 | 소속된 팀의 업무 등록·수정, 팀원 조회 |

- 회원·팀장은 **자신이 속한 팀만** 목록에 표시됩니다(권한 없는 팀은 노출되지 않음). 관리자는 전체를 봅니다.
- 팀장·관리자에게만 팀 목록에 **"팀 등록" 버튼**이 보입니다.

## 🗂️ 프로젝트 구조

```
campusflow/
├─ apps/
│  ├─ api/                 # 백엔드 API 서버 (무의존성 Node.js)
│  │  ├─ server.js         #   HTTP 라우팅 · 엔드포인트 · 권한 검증
│  │  ├─ db.js             #   SQLite 데이터 계층 · 스키마 · 시드 · 마이그레이션
│  │  ├─ auth.js           #   비밀번호 해싱 · 토큰 · 권한 가드
│  │  ├─ errors.js         #   공용 ApiError
│  │  ├─ server.test.js    #   node:test 통합 테스트
│  │  └─ Dockerfile
│  └─ web/                 # 프론트엔드 SPA (React + TS + Vite)
│     ├─ src/              #   App.tsx · components/ · fetch/ · reducers/ · types/ · utils/
│     ├─ public/
│     ├─ vite.config.ts    #   루트 .env 로 포트·API 주소 구성
│     └─ Dockerfile · nginx.conf
├─ .env.example            # ⭐ 통합 환경설정 (포트·시크릿·계정 등 한 곳에서)
├─ docker-compose.yml      # 한 번에 실행 (권장)
├─ package.json            # npm workspaces · 통합 스크립트
├─ README.md · LICENSE · .gitignore
```

## 🚀 빠르게 시작하기

### 방법 A — Docker Compose (권장, 한 줄 실행)

> Docker Desktop(또는 Docker Engine + Compose)만 설치되어 있으면 됩니다. Node 설치 불필요.

```bash
cp .env.example .env     # (선택) 포트·계정 등 커스터마이즈
docker compose up --build
```

- 웹: **http://localhost:5173** (= `WEB_PORT`)
- API: **http://localhost:4000** (= `API_PORT`)
- 포트를 바꾸려면 `.env`의 `API_PORT` / `WEB_PORT`만 수정하면 양쪽(웹·API)에 함께 반영됩니다.
- 데이터는 `api-data` 볼륨에 영구 저장됩니다. 종료는 `docker compose down`, 데이터까지 삭제는 `docker compose down -v`.

### 방법 B — 로컬 개발 (Node ≥ 22.9)

루트에서 한 번만 설치하면 모든 워크스페이스가 준비됩니다.

```bash
cp .env.example .env   # (선택) 포트·계정 등 커스터마이즈
npm install            # apps/* 의존성 일괄 설치 (백엔드는 의존성 0)

npm run dev            # API + 웹 동시 실행 (macOS/Linux)
# 또는 따로:
npm run dev:api        # 백엔드만
npm run dev:web        # 프론트만
```

- 웹: **http://localhost:${WEB_PORT}**(기본 5173), API: **http://localhost:${API_PORT}**(기본 4000)
- 루트 `.env`의 `API_PORT` / `WEB_PORT` 하나만 바꾸면 API·웹·프론트의 API 호출 주소까지 모두 함께 반영됩니다.
- Windows에서 `npm run dev`로 동시 실행이 어려우면 두 터미널에서 `dev:api`, `dev:web`을 각각 실행하거나 방법 A(Docker)를 사용하세요.

### 도메인 배포 (Coolify 등)

- 프론트는 **같은 도메인의 상대경로 `/api/`** 로 백엔드를 호출하고, web의 nginx가 `/api/`를 api 컨테이너로 프록시합니다 → **별도 도메인·CORS 설정 불필요**.
- 별도의 API 도메인을 쓰려면 `VITE_API_BASE`에 절대 URL(예: `https://api.example.com/api/`)을 지정하세요. 프론트는 **빌드 시점에 주소가 박히므로** 변경 시 **재배포(rebuild)** 가 필요합니다.
- `docker-compose.yml`의 모든 환경값은 `${VAR:-기본값}` 형태라 Coolify 같은 플랫폼이 **관리형 변수**로 인식합니다(“Hardcoded env” 경고 없음).
- 최초 배포 후 관리자 비밀번호는 api 컨테이너 로그(`docker compose logs api`)에서 확인하거나 `ADMIN_PASSWORD`로 지정하세요.

## 🔑 초기 관리자 계정

비밀번호는 코드에 **하드코딩하지 않습니다.** 최초 실행(DB가 비어 있을 때)에 다음 규칙으로 관리자 계정이 생성됩니다.

- `ADMIN_PASSWORD`(8자 이상)를 지정하면 그 값으로 생성됩니다.
- 지정하지 않으면 **무작위 비밀번호가 생성되어 서버 로그에 1회만 출력**됩니다.
  - 로컬 실행: 터미널 출력 확인 · Docker: `docker compose logs api`
- 이메일/이름은 `ADMIN_EMAIL`(기본 `admin@example.com`) · `ADMIN_NAME`(기본 `관리자`)로 설정합니다.

초기 데이터에는 **데모 회원·팀이 포함되지 않습니다.** 부트스트랩 관리자 계정으로 로그인한 뒤 실제 회원과 팀을 직접 만드세요.

> 계정 생성은 **관리자만** 가능합니다(자유 회원가입 없음). 운영 전 `ADMIN_PASSWORD`·`TOKEN_SECRET`을 반드시 지정하세요.

## ⚙️ 환경 변수 — 루트 `.env` 하나로 통합

루트의 [`.env.example`](.env.example)를 `.env`로 복사해 사용하세요. **백엔드·프론트·Docker가 모두 이 한 파일을 읽습니다.**

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `API_PORT` | `4000` | API 포트(백엔드 + 프론트의 호출 대상) |
| `WEB_PORT` | `5173` | 웹(프론트) 접속 포트 |
| `VITE_API_BASE` | (자동: `http://localhost:${API_PORT}/api/`) | 프론트가 호출할 API 주소를 직접 지정할 때만 사용 |
| `TOKEN_SECRET` | (개발용 기본값) | 토큰 서명 비밀키 — **운영 필수 설정** |
| `TOKEN_TTL_SECONDS` | `604800`(7일) | 토큰 만료(초) |
| `ADMIN_EMAIL` / `ADMIN_NAME` | `admin@example.com` / `관리자` | 최초 시드 관리자 계정 |
| `ADMIN_PASSWORD` | (미설정 시 무작위 생성·로그) | 관리자 비밀번호(8자 이상) |
| `DB_PATH` | `apps/api/data/app.db` | SQLite 파일 경로(로컬) |
| `LLM_BASE_URL` / `LLM_MODEL` / `LLM_TIMEOUT_MS` | 로컬 플레이스홀더 | AI 기여도 분석용 LLM 설정 |

> 포트는 `API_PORT` / `WEB_PORT` 두 값만 바꾸면 됩니다. 프론트의 API 호출 주소는 `API_PORT`로 자동 구성되고, Docker의 포트 매핑도 동일 값을 사용합니다.

## 🔌 주요 API 엔드포인트

| 메서드 | 경로 | 권한 |
| --- | --- | --- |
| `POST` | `/api/login` | 공개 |
| `GET` | `/api/me` · `POST /api/logout` | 인증 |
| `GET` | `/api/rooms` | 인증 (회원·팀장은 소속 팀만, 관리자는 전체) |
| `POST` | `/api/rooms` | **관리자·팀장** (팀 생성) |
| `PATCH/DELETE` | `/api/rooms/:id` | 회원(소속)·관리자 |
| `GET/POST/PATCH/DELETE` | `/api/rooms/:id/tasks[/:taskId]` | 회원(소속)·관리자 |
| `POST` | `/api/rooms/:id/contribution` | 회원(소속)·관리자 |
| `GET/POST` | `/api/admin/users` | 관리자 (생성 시 역할 지정 가능) |
| `POST` | `/api/admin/users/:id/reset-password` | 관리자 |
| `PATCH` | `/api/admin/users/:id/role` | 관리자 (회원/팀장/관리자) |
| `PATCH` | `/api/admin/users/:id/active` | 관리자 (활성/비활성) |

전체 목록은 [`apps/api/README.md`](apps/api/README.md)를 참고하세요.

## 🧪 테스트

```bash
npm test               # 루트에서 (= apps/api 통합 테스트, 인메모리 SQLite)
```

## 🔒 보안 참고

- **기본 관리자 비밀번호를 하드코딩하지 않습니다.** 환경변수로 지정하거나, 미지정 시 무작위 생성되어 로그에 1회만 노출됩니다.
- 비밀번호는 `scrypt`(per-user salt)로 해싱하여 저장합니다.
- 토큰은 HMAC-SHA256으로 서명·검증되며 만료(`exp`)를 포함합니다.
- 비활성화된 계정의 토큰은 매 요청 시 DB 재조회로 차단됩니다.
- 업무 담당자는 클라이언트 입력을 무시하고 인증된 사용자 이름으로 서버가 강제 지정합니다.
- 권한 없는 팀(방)은 목록 조회 단계에서 제외되며, 직접 API 접근도 서버에서 차단(403)됩니다.
- 팀 생성·역할 변경 등 권한이 필요한 작업은 서버에서 역할을 재검증합니다(프론트의 버튼 숨김에만 의존하지 않음).
- 저장소에는 내부 IP·실제 자격증명이 포함되어 있지 않습니다(LLM 엔드포인트는 환경변수로 설정).

## 🗺️ 로드맵

- [x] 실제 인증 + **3단계 역할(관리자/팀장/회원)** + SQLite 영구 저장 + 담당자 자동 지정 *(완료)*
- [x] 관리자 패널(계정·역할·비번·활성화) + 팀 권한 스코프 *(완료)*
- [x] 도메인 배포(Docker Compose · Coolify) + 스키마 자동 마이그레이션 *(완료)*
- [ ] 감사 로그(로그인·생성·수정·삭제 기록)
- [ ] 통계 대시보드(사용자/팀/업무 집계·완료율)
- [ ] 알림(마감 임박·업무 배정)
- [ ] 비밀번호 정책·재설정·로그인 시도 제한
- [ ] 운영 자동화(백업·복구·CI/CD 파이프라인)

## 📄 라이선스

이 프로젝트는 [MIT 라이선스](LICENSE)를 따릅니다.
