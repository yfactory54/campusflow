import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 저장소 루트의 통합 .env 를 읽어 포트/ API 주소를 결정한다.
// (로컬 개발: loadEnv 로 루트 .env 로드 / Docker 빌드: process.env 의 ARG 사용)
export default defineConfig(({ mode }) => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const env = loadEnv(mode, rootDir, "");

  // 빈 문자열(미주입 ARG 등)은 통과시키도록 || 사용.
  const apiPort = process.env.API_PORT || env.API_PORT || "4000";
  const webPort = Number(process.env.WEB_PORT || env.WEB_PORT) || 5173;

  // 기본은 같은 도메인 상대경로 "/api/" — web 의 nginx 가 api 컨테이너로 프록시한다.
  // 별도의 API 도메인을 쓸 때만 VITE_API_BASE 에 절대 URL 을 지정한다.
  const apiBase = process.env.VITE_API_BASE || env.VITE_API_BASE || "/api/";

  return {
    plugins: [react()],
    server: {
      host: true,
      port: webPort,
      // 로컬 개발: 상대경로 /api 요청을 백엔드(API_PORT)로 프록시.
      proxy: {
        "/api": {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    define: {
      __API_BASE__: JSON.stringify(apiBase),
    },
  };
});
