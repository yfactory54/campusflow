# 1) 빌드 단계 — Vite 정적 번들 생성
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# 기본은 같은 도메인 상대경로 /api/ (nginx 가 api 로 프록시). 별도 API 도메인을 쓸 때만 VITE_API_BASE 주입.
ARG VITE_API_BASE
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# 2) 서빙 단계 — nginx 로 정적 파일 제공(SPA 폴백 포함)
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
