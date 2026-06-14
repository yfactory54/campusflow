# @campusflow/web

CampusFlow 모노레포의 프론트엔드 SPA(`apps/web`)입니다. React 19 + TypeScript + Vite 기반입니다.

> 전체 실행(Docker Compose, 루트 워크스페이스)은 저장소 루트의 [README](../../README.md)를 참고하세요. 아래는 프론트 단독 실행 기준입니다.

```bash
npm install        # 의존성 설치
npm run dev        # 개발 서버 (기본 http://localhost:5173)
npm run build      # 프로덕션 번들 생성(dist/)
npm run lint       # ESLint
npm run preview    # 빌드 결과 미리보기
```

## 환경 변수

설정은 **저장소 루트의 통합 [`.env`](../../.env.example)** 한 파일에서 관리합니다. `vite.config.ts`가 빌드/개발 시 루트 `.env`를 읽어 다음을 결정합니다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `WEB_PORT` | `5173` | 개발 서버 포트 |
| `API_PORT` | `4000` | 프론트가 호출할 API 포트(주소 자동 구성) |
| `VITE_API_BASE` | (자동 구성) | API 주소를 직접 지정할 때만 사용 |

## 구조

```
src/
├─ App.tsx           # 라우팅 · 세션 · 역할
├─ components/       # Login, Header, TaskForm, TaskEditForm, AdminPanel, TeamManager ...
├─ fetch/            # 인증 헤더 포함 API 클라이언트(useFetch)
├─ reducers/         # 업무 상태 리듀서
├─ types/            # 타입 정의
└─ utils/            # 검증 · 날짜 · 라벨 유틸
```
