# 백엔드: 외부 npm 의존성이 없어 빌드/설치 단계가 필요 없다.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY server.js db.js auth.js errors.js ./

ENV NODE_ENV=production
ENV PORT=4000
# SQLite 데이터는 마운트된 볼륨(/app/data)에 영구 저장된다.
ENV DB_PATH=/app/data/app.db

EXPOSE 4000

CMD ["npm", "run", "start"]
