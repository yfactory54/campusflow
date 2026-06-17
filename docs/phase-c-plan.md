# Phase C — 운영 보안 강화

> **목표:** 무차별 로그인, 토큰 폐기 불가, 약한 비밀번호, 느슨한 CORS·헤더 같은 운영 환경의 표준적인 약점을 제거한다.
> **전제:** Phase A·B 완료. 상위 문서: `docs/phase2-plan.md`.
> **완료일:** 2026-06-17.

각 항목은 독립적으로 도입 가능하며, 영향도가 큰 순서로 정렬했다.

---

## C-1. 로그인 시도 제한 (Rate Limit)

### 문제
`apps/api/server.js:195`의 `handleLogin`은 시도 횟수 제한이 없어 자격증명 무차별 대입에 노출.

### 변경
- `apps/api/auth.js`에 인메모리 슬라이딩 윈도 카운터 추가:
  ```js
  // key: `${ip}|${email}`, value: { count, resetAt }
  const LOGIN_WINDOW_MS = 15 * 60 * 1000;
  const LOGIN_MAX = 5;
  const buckets = new Map();
  export const checkLoginRate = (ip, email) => { /* count++, throw ApiError(429) if exceeded */ };
  export const resetLoginRate = (ip, email) => buckets.delete(`${ip}|${email}`);
  ```
- `handleLogin` 진입 시 `checkLoginRate(ip, email)` 호출. 비밀번호 검증 통과 시 `resetLoginRate` 호출.
- 응답 헤더에 `Retry-After: <seconds>` 포함.
- `detail`에 IP/email을 담아 감사 로그(`login.failure`)에 이미 기록되므로 추가 로깅 불필요.

### 주의 — 단일 프로세스 한정
인메모리 Map은 다중 인스턴스에서 동작하지 않는다. 운영이 단일 노드(현재 docker-compose 기준)일 때만 충분. 수평 확장 시 Redis/Memcached 같은 공유 스토어가 필요 — README·docs에 명시.

### 테스트
- 동일 IP+email 로 잘못된 비밀번호 5회 → 6회째 429, `Retry-After` 헤더 존재.
- 성공 로그인 후 카운터가 리셋되는지.
- 윈도 만료 후(`resetAt` 강제 조작) 다시 허용되는지.

---

## C-2. 세션 무효화 (Token Versioning)

### 문제
stateless 토큰은 개별 폐기가 불가능하다. 비번 초기화·비활성화·역할 변경 후에도 기존 토큰이 만료 전까지 유효(`apps/web/src/App.tsx:50` 로그아웃도 best-effort).

### 변경
1. **스키마:** `users.token_version INTEGER NOT NULL DEFAULT 1` 컬럼 추가. `migrateUsersTokenVersion()` 추가 — `ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1` (제약 단순하므로 ALTER로 충분).
2. **토큰 페이로드:** `signToken(user)`(`apps/api/auth.js:47`) payload에 `tv: user.tokenVersion` 추가.
3. **`requireAuth`(`apps/api/auth.js:109`):** DB 재조회한 `user.tokenVersion`과 `payload.tv` 불일치 시 `ApiError(401, '세션이 만료되었습니다.')`.
4. **버전 증가 지점:**
   - `POST /api/admin/users/:id/reset-password`
   - `PATCH /api/admin/users/:id/role`
   - `PATCH /api/admin/users/:id/active` (false → true 무관, 비활성화 시 강제)
   - 신규 `POST /api/me/logout-all` — 본인이 자기 token_version 증가.
5. **DB 함수:** `db.bumpTokenVersion(userId)` 추가.

### UI
- `AdminPanel`에 "모든 세션 강제 종료" 버튼(관리자가 임의 사용자의 token_version을 증가) — 비밀번호 초기화 흐름과 묶어도 됨.
- 헤더에 "모든 기기 로그아웃" 메뉴(자신의 token_version 증가).

### 테스트
- 토큰 발급 → 비번 초기화 → 같은 토큰으로 보호 라우트 호출 → 401.
- 발급 → 일반 흐름 → 200 그대로.

---

## C-3. 비밀번호 정책

### 문제
현재 검증은 `password.length >= 8` 뿐(`apps/api/server.js:243`, `:276`).

### 변경
- `apps/api/auth.js`에 `validatePasswordStrength(plain): void` 추가:
  - 최소 길이 10자 이상.
  - 영문/숫자/특수문자 중 2종류 이상 포함.
  - 흔한 비밀번호 블랙리스트(짧은 내장 목록) 매칭 거부 — `password`, `qwerty`, `12345678`, `admin1234` 등 20~30개.
  - 위반 시 `ApiError(400, 사유)`.
- 적용 지점:
  - `POST /api/admin/users` (계정 생성)
  - `POST /api/admin/users/:id/reset-password` (관리자 초기화)
  - 신규 `POST /api/me/password` (사용자 본인 변경 — 추가 권장)
- 부트스트랩 관리자 비밀번호 자동 생성(`generatePassword`, `apps/api/auth.js:36`)은 충분히 강하므로 그대로 사용. 환경변수 `ADMIN_PASSWORD`도 정책 검증 통과 필요(`apps/api/db.js:122`).

### UI
- 계정 생성/비번 초기화 폼에 정책 안내 문구. 서버 에러 메시지를 그대로 노출.

### 테스트
- 길이 부족, 단일 문자 클래스, 블랙리스트 케이스 각각 400.
- 정책 통과 케이스 201/200.

---

## C-4. CORS 운영 제한

### 문제
`apps/api/server.js:31`의 `access-control-allow-origin: *` — 운영에서도 모든 출처에서 호출 가능.

### 변경
- 환경변수 `CORS_ORIGIN`(쉼표 구분 허용 목록) 도입. 미설정 시 개발 편의로 `*`를 유지하되 시작 로그에 경고.
- `request.headers.origin`이 허용 목록에 포함되면 그 출처를 그대로 반사, 아니면 헤더 누락.
- `Vary: Origin` 추가.
- `docker-compose.yml`·`.env.example`에 `CORS_ORIGIN=https://campusflow.example.com` 예시 추가.

### 테스트
- 허용된 출처에서 `OPTIONS` 프리플라이트 → 정상 응답.
- 허용 외 출처 → CORS 헤더 미포함(브라우저가 차단).

---

## C-5. nginx 보안 헤더

### 문제
`apps/web/nginx.conf`(1~25행)에 보안 헤더가 없다.

### 변경
`server { ... }` 안에 다음 추가:
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
# CSP — 인라인 스타일/스크립트 사용 여부 확인 후 미세조정 필요
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'" always;
```
- HSTS는 HTTPS 종단(Coolify/리버스 프록시)에서 한 번만 적용. 중복 시 효과 동일.
- CSP의 `'unsafe-inline'`은 Tailwind 런타임에 따라 필요할 수 있어 빌드 후 점검 필수. 위반 시 브라우저 콘솔의 CSP 리포트로 조정.

### 검증
- `curl -I https://campusflow.example.com` → 모든 헤더 존재.
- 브라우저에서 모든 페이지 정상 동작(CSP 위반 0).
- securityheaders.com 등 외부 스캐너에서 A 이상.

---

## 검증 (Phase C 완료 기준)
1. 단위·통합 테스트 통과(`npm test`).
2. 무차별 로그인 시도가 5회 후 차단되고 정상 사용자 로그인엔 영향 없음.
3. 비번 초기화 후 기존 세션이 즉시 무효화됨.
4. 약한 비밀번호로 계정 생성 시도 시 명확한 400.
5. 허용 외 출처에서 브라우저 fetch가 CORS로 차단.
6. 운영 도메인에 보안 헤더가 모두 응답에 포함.
7. README 로드맵 갱신, 변경 사항을 `apps/api/README.md`에 환경변수 표로 정리.

## 주요 파일
- 백엔드: `apps/api/auth.js`, `apps/api/db.js`, `apps/api/server.js`, `apps/api/server.test.js`, `apps/api/README.md`
- 프론트: `apps/web/src/components/{AdminPanel,Header}.tsx`, `apps/web/src/App.tsx`
- 운영: `apps/web/nginx.conf`, `.env.example`, `docker-compose.yml`
