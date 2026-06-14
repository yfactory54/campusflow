import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';

const TOKEN_SECRET = process.env.TOKEN_SECRET ?? 'dev-insecure-secret-change-me';
const TOKEN_TTL_SECONDS = Number(process.env.TOKEN_TTL_SECONDS ?? 60 * 60 * 24 * 7); // 기본 7일
const KEY_LENGTH = 64;

if (!process.env.TOKEN_SECRET) {
  console.warn(
    '[auth] TOKEN_SECRET 환경변수가 설정되지 않아 개발용 기본 비밀키를 사용합니다. 운영 환경에서는 반드시 설정하세요. ' +
      '(Using insecure development token secret — set TOKEN_SECRET in production.)',
  );
}

// ---- 비밀번호 해싱 (scrypt) ----

export const hashPassword = (plain) => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, KEY_LENGTH).toString('hex');
  return { hash, salt };
};

export const verifyPassword = (plain, hash, salt) => {
  if (typeof hash !== 'string' || typeof salt !== 'string') {
    return false;
  }
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(plain, salt, KEY_LENGTH);
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
};

// 무작위 비밀번호 생성(시드 계정에 비밀번호가 지정되지 않았을 때 사용)
export const generatePassword = (bytes = 12) => randomBytes(bytes).toString('base64url');

// ---- 토큰 (HMAC-SHA256 서명, 최소 JWT 형태) ----

const base64urlEncode = (input) =>
  Buffer.from(input).toString('base64url');

const base64urlDecode = (input) => Buffer.from(input, 'base64url').toString('utf8');

const sign = (data) => createHmac('sha256', TOKEN_SECRET).update(data).digest('base64url');

export const signToken = (user) => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    iat: issuedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS,
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signature = sign(`${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

export const verifyToken = (token) => {
  if (typeof token !== 'string') {
    throw new ApiError(401, '인증이 필요합니다.');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new ApiError(401, '인증 토큰이 올바르지 않습니다.');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`);

  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new ApiError(401, '인증 토큰이 올바르지 않습니다.');
  }

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(encodedPayload));
  } catch {
    throw new ApiError(401, '인증 토큰이 올바르지 않습니다.');
  }

  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new ApiError(401, '세션이 만료되었습니다. 다시 로그인하세요.');
  }

  return payload;
};

// ---- 요청 가드 (핸들러 상단에서 호출) ----

const extractBearerToken = (request) => {
  const header = request.headers.authorization ?? '';
  const [scheme, value] = header.split(' ');
  if (scheme !== 'Bearer' || !value) {
    return null;
  }
  return value;
};

export const requireAuth = (request, db) => {
  const token = extractBearerToken(request);
  if (!token) {
    throw new ApiError(401, '인증이 필요합니다.');
  }

  const payload = verifyToken(token);
  const user = db.findUserById(payload.sub);
  if (!user) {
    throw new ApiError(401, '인증이 필요합니다.');
  }
  if (!user.isActive) {
    throw new ApiError(403, '비활성화된 계정입니다.');
  }

  return user;
};

export const requireAdmin = (request, db) => {
  const user = requireAuth(request, db);
  if (user.role !== 'admin') {
    throw new ApiError(403, '관리자 권한이 필요합니다.');
  }
  return user;
};

export const assertRoomAccess = (db, roomId, user) => {
  if (user.role === 'admin' || db.isMember(roomId, user.id)) {
    return;
  }
  throw new ApiError(403, '이 방에 접근할 권한이 없습니다.');
};
