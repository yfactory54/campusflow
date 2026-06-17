import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './errors.js';
import { openDatabase } from './db.js';
import {
  assertRoomAccess,
  assertRoomManage,
  checkLoginRate,
  hashPassword,
  resetLoginRate,
  requireAdmin,
  requireAuth,
  signToken,
  verifyPassword,
  validatePasswordStrength,
} from './auth.js';

const serviceName = 'react-class-api';
const allowedCategories = new Set(['assignment', 'exam', 'team-project', 'study']);
const allowedPriorities = new Set(['low', 'medium', 'high']);
const allowedStatuses = new Set(['todo', 'inProgress', 'done']);
const allowedRoles = new Set(['admin', 'leader', 'member']);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const corsWarningShown = new Set();

// OpenAI 호환 LLM 설정 — AI 기여도 분석 기능을 쓰려면 LLM_BASE_URL 을 .env 로 지정하세요.
// (기본값은 로컬 플레이스홀더이며, 미설정 시 기여도 분석 호출은 실패합니다.)
const LLM_BASE_URL = process.env.LLM_BASE_URL ?? 'http://localhost:8000/v1';
const hasLlmConfig = Boolean(process.env.LLM_BASE_URL?.trim());
const LLM_MODEL = process.env.LLM_MODEL ?? 'gpt-4o-mini';
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 90_000);

const statusLabels = { todo: '할 일', inProgress: '진행 중', done: '완료' };
const priorityLabels = { low: '낮음', medium: '보통', high: '높음' };

const baseCorsHeaders = {
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
  vary: 'Origin',
};

const getAllowedCorsOrigins = () =>
  (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const buildCorsHeaders = (request) => {
  const origin = request?.headers?.origin;
  const allowedOrigins = getAllowedCorsOrigins();

  if (allowedOrigins.length === 0) {
    if (!corsWarningShown.has('default')) {
      console.warn('[cors] CORS_ORIGIN 미설정: 개발 편의를 위해 모든 Origin 을 허용합니다.');
      corsWarningShown.add('default');
    }
    return { ...baseCorsHeaders, 'access-control-allow-origin': '*' };
  }

  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    return { ...baseCorsHeaders, 'access-control-allow-origin': origin };
  }

  return baseCorsHeaders;
};

const sendJson = (response, status, payload, extraHeaders = {}) => {
  const body = JSON.stringify(payload);

  response.writeHead(status, {
    ...(response.corsHeaders ?? baseCorsHeaders),
    ...extraHeaders,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
};

const sendNoContent = (response, extraHeaders = {}) => {
  response.writeHead(204, { ...(response.corsHeaders ?? baseCorsHeaders), ...extraHeaders });
  response.end();
};

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const toTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '');

const readJsonBody = async (request) => {
  let rawBody = '';

  for await (const chunk of request) {
    rawBody += chunk;

    if (Buffer.byteLength(rawBody) > 1_000_000) {
      throw new ApiError(413, '요청 본문이 너무 큽니다.');
    }
  }

  if (!rawBody) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawBody);
    return isRecord(parsed) ? parsed : {};
  } catch {
    throw new ApiError(400, 'JSON 형식이 올바르지 않습니다.');
  }
};

const parseRoomId = (value) => {
  const roomId = Number(value);
  return Number.isInteger(roomId) ? roomId : null;
};

const assertRoomExists = (db, roomId) => {
  const room = db.findRoom(roomId);

  if (!room) {
    throw new ApiError(404, '방을 찾을 수 없습니다.');
  }

  return room;
};

const assertDateInput = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(400, '마감일은 YYYY-MM-DD 형식이어야 합니다.');
  }
};

const publicUser = (user) => ({ id: user.id, email: user.email, name: user.name, role: user.role });

const getClientIp = (request) => {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return request.socket.remoteAddress ?? '';
};

const recordAudit = (db, request, event) => {
  try {
    db.insertAuditEvent({ ...event, ip: getClientIp(request) });
  } catch (error) {
    console.error('[audit] failed to record event', error);
  }
};

const readAuditFilters = (url) => {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20), 1), 100);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0);
  const actorIdParam = url.searchParams.get('actorId');
  const actorId = actorIdParam ? Number(actorIdParam) : null;

  return {
    limit,
    offset,
    action: toTrimmedString(url.searchParams.get('action')),
    actorId: Number.isInteger(actorId) ? actorId : null,
    since: toTrimmedString(url.searchParams.get('since')),
  };
};

const buildChangeDetail = (before, fields) =>
  Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, { from: before?.[key], to: value }]),
  );

const csvEscape = (value) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const sendCsv = (response, filename, rows) => {
  const body = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  response.writeHead(200, {
    ...(response.corsHeaders ?? baseCorsHeaders),
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
};

const notifyAssignee = (db, task, actor) => {
  const [assignee] = db.findUsersByNames([task.assignee]);
  if (!assignee || assignee.id === actor.id) return;

  db.insertNotification({
    userId: assignee.id,
    kind: 'task.assigned',
    targetType: 'task',
    targetId: task.id,
    message: `${actor.name}님이 '${task.title}' 업무를 배정했습니다.`,
    createdAt: new Date().toISOString(),
  });
};

const ensureDueNotifications = (db, user) => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const now = new Date().toISOString();
  for (const task of db.listAllTasks()) {
    if (task.assignee === user.name && task.status !== 'done' && task.dueDate <= tomorrow) {
      db.insertNotification({
        userId: user.id,
        kind: 'task.due_soon',
        targetType: 'task',
        targetId: task.id,
        message: `'${task.title}' 업무 마감일이 다가왔습니다 (${task.dueDate}).`,
        createdAt: now,
      });
    }
  }
};

const priorityWeights = { low: 1, medium: 2, high: 3 };

const computeContributionFallback = (members, tasks) => {
  const raw = members.map((member) => {
    const assignedTasks = tasks.filter((task) => task.assignee === member.name);
    const scoreBase = assignedTasks.reduce((sum, task) => {
      const weight = priorityWeights[task.priority] ?? 1;
      if (task.status === 'done') return sum + weight;
      if (task.status === 'inProgress') return sum + weight * 0.5;
      return sum;
    }, 0);
    return {
      name: member.name,
      scoreBase,
      assignedCount: assignedTasks.length,
      completedCount: assignedTasks.filter((task) => task.status === 'done').length,
    };
  });
  const total = raw.reduce((sum, member) => sum + member.scoreBase, 0);

  return {
    source: 'fallback',
    members: raw.map((member) => ({
      name: member.name,
      score: total ? Math.round((member.scoreBase / total) * 100) : 0,
      assignedCount: member.assignedCount,
      completedCount: member.completedCount,
      summary: member.assignedCount
        ? `규칙 기반 계산 결과입니다. 완료 ${member.completedCount}건 / 담당 ${member.assignedCount}건입니다.`
        : '담당 업무가 없습니다.',
    })),
    summary: 'LLM 분석을 사용할 수 없어 업무 상태와 우선순위 가중치로 계산했습니다.',
  };
};

const createRoom = (db, input, currentUser) => {
  const name = toTrimmedString(input.name);

  if (!name) {
    throw new ApiError(400, '방 이름이 필요합니다.');
  }

  return db.insertRoom({
    name,
    description: toTrimmedString(input.description) || '새로 생성된 프로젝트 협업 팀입니다.',
    createdAt: new Date().toISOString(),
    creatorId: currentUser.id,
  });
};

const createTask = (db, roomId, input, currentUser) => {
  const title = toTrimmedString(input.title);
  const dueDate = toTrimmedString(input.dueDate);
  const priority = allowedPriorities.has(input.priority) ? input.priority : 'medium';
  const category = allowedCategories.has(input.category) ? input.category : 'assignment';

  if (!title) {
    throw new ApiError(400, '업무 제목이 필요합니다.');
  }

  assertDateInput(dueDate);

  // 담당자는 로그인 세션 사용자 이름으로 서버에서 강제(클라이언트 입력 무시).
  return db.insertTask({
    roomId,
    title,
    dueDate,
    priority,
    status: 'todo',
    category,
    assignee: currentUser.name,
    memo: toTrimmedString(input.memo),
    createdAt: new Date().toISOString(),
  });
};

const buildTaskUpdate = (input) => {
  const fields = {};

  if ('title' in input) {
    const title = toTrimmedString(input.title);

    if (!title) {
      throw new ApiError(400, '업무 제목이 필요합니다.');
    }

    fields.title = title;
  }

  if ('dueDate' in input) {
    const dueDate = toTrimmedString(input.dueDate);
    assertDateInput(dueDate);
    fields.dueDate = dueDate;
  }

  if ('priority' in input) {
    if (!allowedPriorities.has(input.priority)) {
      throw new ApiError(400, '우선순위 값이 올바르지 않습니다.');
    }

    fields.priority = input.priority;
  }

  if ('status' in input) {
    if (!allowedStatuses.has(input.status)) {
      throw new ApiError(400, '상태 값이 올바르지 않습니다.');
    }

    fields.status = input.status;
  }

  if ('category' in input) {
    if (!allowedCategories.has(input.category)) {
      throw new ApiError(400, '카테고리 값이 올바르지 않습니다.');
    }

    fields.category = input.category;
  }

  if ('memo' in input) {
    fields.memo = toTrimmedString(input.memo);
  }



  return fields;
};

const handleLogin = async (request, response, db) => {
  const body = await readJsonBody(request);
  const email = toTrimmedString(body.email);
  const password = toTrimmedString(body.password);
  const ip = getClientIp(request);
  try {
    checkLoginRate(ip, email);
  } catch (error) {
    recordAudit(db, request, {
      actor: null,
      action: 'login.failure',
      targetType: 'user',
      targetId: email,
      detail: { reason: 'rate_limited' },
    });
    throw error;
  }

  if (!emailPattern.test(email) || password.length < 8) {
    recordAudit(db, request, {
      actor: null,
      action: 'login.failure',
      targetType: 'user',
      targetId: email,
      detail: { reason: 'invalid_input' },
    });
    throw new ApiError(400, '유효한 이메일과 8자 이상의 비밀번호가 필요합니다.');
  }

  const user = db.findUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
    recordAudit(db, request, {
      actor: null,
      action: 'login.failure',
      targetType: 'user',
      targetId: email,
      detail: { reason: 'invalid_credentials' },
    });
    throw new ApiError(401, '이메일 또는 비밀번호가 올바르지 않습니다.');
  }
  if (!user.isActive) {
    recordAudit(db, request, {
      actor: user,
      action: 'login.failure',
      targetType: 'user',
      targetId: user.id,
      detail: { reason: 'inactive' },
    });
    throw new ApiError(403, '비활성화된 계정입니다. 관리자에게 문의하세요.');
  }

  resetLoginRate(ip, email);
  recordAudit(db, request, {
    actor: user,
    action: 'login.success',
    targetType: 'user',
    targetId: user.id,
  });

  sendJson(response, 200, {
    token: signToken(user),
    user: publicUser(user),
  });
};

// ---- 관리자 전용 사용자 관리 ----

const handleAdminRoutes = async (request, response, db, pathParts, method, url) => {
  const currentUser = requireAdmin(request, db);

  // /api/admin/audit
  if (pathParts.length === 3 && pathParts[2] === 'audit' && method === 'GET') {
    sendJson(response, 200, db.listAuditEvents(readAuditFilters(url)));
    return;
  }

  // /api/admin/stats
  if (pathParts.length === 3 && pathParts[2] === 'stats' && method === 'GET') {
    sendJson(response, 200, { stats: db.stats() });
    return;
  }

  // /api/admin/export/(tasks.csv|users.csv)
  if (pathParts.length === 4 && pathParts[2] === 'export' && method === 'GET') {
    if (pathParts[3] === 'tasks.csv') {
      sendCsv(response, 'tasks.csv', [
        ['id', 'roomId', 'title', 'dueDate', 'priority', 'status', 'assignee', 'createdAt'],
        ...db.listAllTasks().map((task) => [
          task.id,
          task.roomId,
          task.title,
          task.dueDate,
          task.priority,
          task.status,
          task.assignee,
          task.createdAt,
        ]),
      ]);
      return;
    }
    if (pathParts[3] === 'users.csv') {
      sendCsv(response, 'users.csv', [
        ['id', 'name', 'email', 'role', 'isActive', 'createdAt'],
        ...db.listUsers().map((user) => [
          user.id,
          user.name,
          user.email,
          user.role,
          user.isActive,
          user.createdAt,
        ]),
      ]);
      return;
    }
  }

  // /api/admin/users
  if (pathParts.length === 3 && pathParts[2] === 'users') {
    if (method === 'GET') {
      sendJson(response, 200, { users: db.listUsers() });
      return;
    }

    if (method === 'POST') {
      const body = await readJsonBody(request);
      const name = toTrimmedString(body.name);
      const email = toTrimmedString(body.email);
      const password = toTrimmedString(body.password);
      const role = allowedRoles.has(body.role) ? body.role : 'member';

      if (!name) {
        throw new ApiError(400, '이름이 필요합니다.');
      }
      if (!emailPattern.test(email)) {
        throw new ApiError(400, '유효한 이메일이 필요합니다.');
      }
      validatePasswordStrength(password);
      if (db.findUserByEmail(email)) {
        throw new ApiError(400, '이미 등록된 이메일입니다.');
      }

      const { hash, salt } = hashPassword(password);
      const user = db.insertUser({
        name,
        email,
        passwordHash: hash,
        salt,
        role,
        createdAt: new Date().toISOString(),
      });
      recordAudit(db, request, {
        actor: currentUser,
        action: 'user.create',
        targetType: 'user',
        targetId: user.id,
        detail: { role: user.role, email: user.email },
      });
      sendJson(response, 201, { user });
      return;
    }
  }

  // /api/admin/users/:id/(reset-password|role|active)
  if (pathParts.length === 5 && pathParts[2] === 'users') {
    const userId = Number(pathParts[3]);
    const target = db.findUserById(userId);
    if (!target) {
      throw new ApiError(404, '사용자를 찾을 수 없습니다.');
    }
    const action = pathParts[4];
    const body = await readJsonBody(request);

    if (action === 'reset-password' && method === 'POST') {
      const password = toTrimmedString(body.password);
      validatePasswordStrength(password);
      const { hash, salt } = hashPassword(password);
      db.updatePassword(userId, hash, salt);
      db.bumpTokenVersion(userId);
      recordAudit(db, request, {
        actor: currentUser,
        action: 'user.password.reset',
        targetType: 'user',
        targetId: userId,
      });
      sendJson(response, 200, { ok: true });
      return;
    }

    if (action === 'role' && method === 'PATCH') {
      if (!allowedRoles.has(body.role)) {
        throw new ApiError(400, '권한 값이 올바르지 않습니다.');
      }
      db.updateRole(userId, body.role);
      db.bumpTokenVersion(userId);
      const updated = db.findUserById(userId);
      recordAudit(db, request, {
        actor: currentUser,
        action: 'user.role.update',
        targetType: 'user',
        targetId: userId,
        detail: { from: target.role, to: updated.role },
      });
      sendJson(response, 200, { user: updated });
      return;
    }

    if (action === 'active' && method === 'PATCH') {
      if (typeof body.isActive !== 'boolean') {
        throw new ApiError(400, '활성 여부(isActive)는 boolean 이어야 합니다.');
      }
      db.setActive(userId, body.isActive);
      db.bumpTokenVersion(userId);
      const updated = db.findUserById(userId);
      recordAudit(db, request, {
        actor: currentUser,
        action: 'user.active.update',
        targetType: 'user',
        targetId: userId,
        detail: { from: target.isActive, to: updated.isActive },
      });
      sendJson(response, 200, { user: updated });
      return;
    }

    if (action === 'logout-all' && method === 'POST') {
      db.bumpTokenVersion(userId);
      recordAudit(db, request, {
        actor: currentUser,
        action: 'user.session.revoke',
        targetType: 'user',
        targetId: userId,
      });
      sendJson(response, 200, { ok: true });
      return;
    }
  }

  sendJson(response, 404, { error: '요청한 API를 찾을 수 없습니다.' });
};



const parseLlmJson = (text) => {
  // 코드펜스 및 추론(<think>) 블록 제거
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // 모델이 JSON 앞뒤로 설명을 덧붙인 경우 첫 { ~ 마지막 } 구간만 파싱
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start === -1 || end <= start) {
      throw new Error('JSON 객체를 찾을 수 없습니다.');
    }

    return JSON.parse(cleaned.slice(start, end + 1));
  }
};

const buildContributionPrompt = (memberNames, tasks) => {
  const taskLines = tasks
    .map((task, index) => {
      const due = task.dueDate ? ` / 마감:${task.dueDate}` : '';
      return `${index + 1}. 제목:"${task.title || '제목없음'}" / 담당자:${task.assignee || '미지정'} / 상태:${statusLabels[task.status]} / 우선순위:${priorityLabels[task.priority]}${due}`;
    })
    .join('\n');

  return [
    `팀원 목록: ${memberNames.join(', ') || '없음'}`,
    '',
    '업무 목록:',
    taskLines || '(등록된 업무 없음)',
    '',
    '위 정보를 바탕으로 각 팀원의 프로젝트 기여도를 분석해줘.',
    '담당자 이름을 팀원 이름과 매칭하고, 완료(done)한 업무와 우선순위를 가중치로 고려해.',
    '담당 업무가 없는 팀원의 기여도는 0으로 둬.',
    '반드시 아래 JSON 형식으로만 답하고, 모든 설명은 한국어로 작성해.',
    '{',
    '  "members": [',
    '    { "name": "팀원이름", "score": 0~100 정수(전체 합이 100에 가깝게), "assignedCount": 담당업무수, "completedCount": 완료업무수, "summary": "한두 문장 평가" }',
    '  ],',
    '  "summary": "팀 전체 기여도에 대한 총평"',
    '}',
  ].join('\n');
};

const requestContributionAnalysis = async (members, tasks) => {
  if (!hasLlmConfig) {
    throw new ApiError(502, '기여도 분석 서버가 설정되지 않았습니다.');
  }
  const memberNames = members.map((member) => member.name);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '너는 팀 프로젝트의 업무 데이터를 분석해 팀원별 기여도를 산출하는 분석가다. 반드시 유효한 JSON만 출력한다.',
          },
          { role: 'user', content: buildContributionPrompt(memberNames, tasks) },
        ],
      }),
    });
  } catch {
    throw new ApiError(502, '기여도 분석 서버에 연결할 수 없습니다.');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new ApiError(502, `기여도 분석 서버 오류가 발생했습니다 (${response.status}).`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content !== 'string' || !content.trim()) {
    throw new ApiError(502, '기여도 분석 결과가 비어 있습니다.');
  }

  let parsed;
  try {
    parsed = parseLlmJson(content);
  } catch {
    throw new ApiError(502, '기여도 분석 결과를 해석할 수 없습니다.');
  }

  const analyzedMembers = Array.isArray(parsed.members)
    ? parsed.members.map((member) => ({
        name: toTrimmedString(member?.name),
        score: Number.isFinite(Number(member?.score)) ? Math.round(Number(member.score)) : 0,
        assignedCount: Number.isFinite(Number(member?.assignedCount)) ? Number(member.assignedCount) : 0,
        completedCount: Number.isFinite(Number(member?.completedCount)) ? Number(member.completedCount) : 0,
        summary: toTrimmedString(member?.summary),
      }))
    : [];

  return {
    source: 'llm',
    members: analyzedMembers,
    summary: toTrimmedString(parsed.summary),
  };
};

const handleRequest = async (request, response, db) => {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://localhost');
  const pathParts = url.pathname.split('/').filter(Boolean);
  response.corsHeaders = buildCorsHeaders(request);

  if (method === 'OPTIONS') {
    sendNoContent(response);
    return;
  }

  // ---- 공개 엔드포인트 ----
  if (method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, service: serviceName });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/login') {
    await handleLogin(request, response, db);
    return;
  }

  if (pathParts[0] !== 'api') {
    sendJson(response, 404, { error: '요청한 API를 찾을 수 없습니다.' });
    return;
  }

  // ---- 인증 필요 엔드포인트 ----
  if (pathParts.length === 2 && pathParts[1] === 'logout' && method === 'POST') {
    requireAuth(request, db);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathParts.length === 2 && pathParts[1] === 'me' && method === 'GET') {
    const user = requireAuth(request, db);
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }

  if (pathParts.length === 3 && pathParts[1] === 'me' && pathParts[2] === 'logout-all' && method === 'POST') {
    const user = requireAuth(request, db);
    db.bumpTokenVersion(user.id);
    recordAudit(db, request, {
      actor: user,
      action: 'user.session.revoke',
      targetType: 'user',
      targetId: user.id,
    });
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathParts.length === 3 && pathParts[1] === 'me' && pathParts[2] === 'password' && method === 'POST') {
    const user = requireAuth(request, db);
    const body = await readJsonBody(request);
    const currentPassword = toTrimmedString(body.currentPassword);
    const nextPassword = toTrimmedString(body.password);
    const userWithSecret = db.findUserByEmail(user.email);
    if (!verifyPassword(currentPassword, userWithSecret.passwordHash, userWithSecret.salt)) {
      throw new ApiError(400, '현재 비밀번호가 올바르지 않습니다.');
    }
    validatePasswordStrength(nextPassword);
    const { hash, salt } = hashPassword(nextPassword);
    db.updatePassword(user.id, hash, salt);
    db.bumpTokenVersion(user.id);
    recordAudit(db, request, {
      actor: user,
      action: 'user.password.change',
      targetType: 'user',
      targetId: user.id,
    });
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathParts.length === 3 && pathParts[1] === 'me' && pathParts[2] === 'notifications' && method === 'GET') {
    const user = requireAuth(request, db);
    ensureDueNotifications(db, user);
    const unread = url.searchParams.get('unread') === '1';
    const notifications = db.listNotifications({ userId: user.id, unread });
    sendJson(response, 200, { notifications, unreadCount: db.unreadNotificationCount(user.id) });
    return;
  }

  if (pathParts.length === 5 && pathParts[1] === 'me' && pathParts[2] === 'notifications' && pathParts[4] === 'read' && method === 'POST') {
    const user = requireAuth(request, db);
    db.markNotificationRead(Number(pathParts[3]), user.id, new Date().toISOString());
    sendJson(response, 200, { ok: true, unreadCount: db.unreadNotificationCount(user.id) });
    return;
  }

  if (pathParts.length === 4 && pathParts[1] === 'me' && pathParts[2] === 'notifications' && pathParts[3] === 'read-all' && method === 'POST') {
    const user = requireAuth(request, db);
    db.markAllNotificationsRead(user.id, new Date().toISOString());
    sendJson(response, 200, { ok: true, unreadCount: 0 });
    return;
  }
  if (pathParts.length === 3 && pathParts[1] === 'users' && pathParts[2] === 'search' && method === 'GET') {
    const currentUser = requireAuth(request, db);
    if (currentUser.role !== 'admin' && currentUser.role !== 'leader') {
      throw new ApiError(403, '사용자를 검색할 권한이 없습니다.');
    }

    const query = toTrimmedString(url.searchParams.get('q'));
    sendJson(response, 200, { users: query ? db.searchActiveUsersByName(query, 20) : [] });
    return;
  }

  // ---- 관리자 전용 ----
  if (pathParts[1] === 'admin') {
    await handleAdminRoutes(request, response, db, pathParts, method, url);
    return;
  }

  if (pathParts.length === 2 && pathParts[1] === 'rooms') {
    const currentUser = requireAuth(request, db);

    if (method === 'GET') {
      // 관리자는 전체, 일반 회원은 소속된 방만(권한 없는 방은 목록에 노출하지 않음).
      const rooms =
        currentUser.role === 'admin' ? db.listRooms() : db.listRoomsForUser(currentUser.id);
      sendJson(response, 200, { rooms });
      return;
    }

    if (method === 'POST') {
      // 팀 생성은 관리자 또는 팀장만 가능.
      if (currentUser.role !== 'admin' && currentUser.role !== 'leader') {
        throw new ApiError(403, '팀을 생성할 권한이 없습니다.');
      }
      const room = createRoom(db, await readJsonBody(request), currentUser);
      recordAudit(db, request, {
        actor: currentUser,
        action: 'room.create',
        targetType: 'room',
        targetId: room.id,
        detail: { name: room.name },
      });
      sendJson(response, 201, { room });
      return;
    }
  }

  if (pathParts[1] === 'rooms') {
    const currentUser = requireAuth(request, db);
    const roomId = parseRoomId(pathParts[2]);

    if (roomId === null) {
      throw new ApiError(404, '방을 찾을 수 없습니다.');
    }

    const room = assertRoomExists(db, roomId);
    assertRoomAccess(db, roomId, currentUser);
    const canManageRoom = () => assertRoomManage(room, currentUser);

    // /api/rooms/:id  (수정/삭제)
    if (pathParts.length === 3) {
      if (method === 'PATCH') {
        canManageRoom();
        const body = await readJsonBody(request);
        const fields = {};
        if ('name' in body) {
          const name = toTrimmedString(body.name);
          if (!name) {
            throw new ApiError(400, '방 이름이 필요합니다.');
          }
          fields.name = name;
        }
        if ('description' in body) {
          fields.description = toTrimmedString(body.description);
        }
        const updated = db.updateRoom(roomId, fields);
        recordAudit(db, request, {
          actor: currentUser,
          action: 'room.update',
          targetType: 'room',
          targetId: roomId,
          detail: buildChangeDetail(room, fields),
        });
        sendJson(response, 200, { room: updated });
        return;
      }

      if (method === 'DELETE') {
        canManageRoom();
        db.deleteRoom(roomId);
        recordAudit(db, request, {
          actor: currentUser,
          action: 'room.delete',
          targetType: 'room',
          targetId: roomId,
          detail: { name: room.name },
        });
        sendNoContent(response);
        return;
      }
    }

    // /api/rooms/:id/members
    if (pathParts.length === 4 && pathParts[3] === 'members') {
      if (method === 'GET') {
        sendJson(response, 200, { members: db.listMembers(roomId) });
        return;
      }

      if (method === 'POST') {
        canManageRoom();
        const body = await readJsonBody(request);
        const userId = Number(body.userId);
        const user = db.findUserById(userId);
        if (!user) throw new ApiError(404, '사용자를 찾을 수 없습니다.');
        if (db.isMember(roomId, userId)) throw new ApiError(400, '이미 팀원입니다.');
        db.addMember(roomId, userId);
        recordAudit(db, request, {
          actor: currentUser,
          action: 'room.member.add',
          targetType: 'room',
          targetId: roomId,
          detail: { userId: user.id, userName: user.name },
        });
        sendJson(response, 201, { member: user });
        return;
      }
    }

    // /api/rooms/:id/members/:userId
    if (pathParts.length === 5 && pathParts[3] === 'members') {
      const userId = Number(pathParts[4]);

      if (method === 'DELETE') {
        canManageRoom();
        if (!db.isMember(roomId, userId)) throw new ApiError(404, '해당 팀원을 찾을 수 없습니다.');
        db.removeMember(roomId, userId);
        recordAudit(db, request, {
          actor: currentUser,
          action: 'room.member.remove',
          targetType: 'room',
          targetId: roomId,
          detail: { userId },
        });
        sendNoContent(response);
        return;
      }
    }

    // /api/rooms/:id/stats
    if (pathParts.length === 4 && pathParts[3] === 'stats') {
      if (method === 'GET') {
        sendJson(response, 200, { stats: db.statsByRoom(roomId) });
        return;
      }
    }
    // /api/rooms/:id/contribution  (업무 목록 상태를 받아 멤버별 기여도 분석)
    if (pathParts.length === 4 && pathParts[3] === 'contribution') {
      if (method === 'POST') {
        const members = db.listMembers(roomId);
        const tasks = db.listTasks(roomId);
        let contribution;
        try {
          contribution = await requestContributionAnalysis(members, tasks);
        } catch {
          contribution = computeContributionFallback(members, tasks);
        }
        sendJson(response, 200, { contribution });
        return;
      }
    }

    if (pathParts.length === 4 && pathParts[3] === 'tasks') {
      if (method === 'GET') {
        sendJson(response, 200, { tasks: db.listTasks(roomId) });
        return;
      }

      if (method === 'POST') {
        const task = createTask(db, roomId, await readJsonBody(request), currentUser);
        recordAudit(db, request, {
          actor: currentUser,
          action: 'task.create',
          targetType: 'task',
          targetId: task.id,
          detail: { roomId, title: task.title },
        });
        notifyAssignee(db, task, currentUser);
        sendJson(response, 201, { task });
        return;
      }
    }

    // /api/rooms/:id/tasks/:taskId/comments
    if (pathParts.length === 6 && pathParts[3] === 'tasks' && pathParts[5] === 'comments') {
      const taskId = decodeURIComponent(pathParts[4]);
      const existing = db.findTask(roomId, taskId);
      if (!existing) throw new ApiError(404, '업무를 찾을 수 없습니다.');

      if (method === 'GET') {
        sendJson(response, 200, { comments: db.listComments(taskId) });
        return;
      }

      if (method === 'POST') {
        const body = await readJsonBody(request);
        const commentBody = toTrimmedString(body.body);
        if (!commentBody) throw new ApiError(400, '댓글 내용이 필요합니다.');
        const comment = db.insertComment({
          taskId,
          authorId: currentUser.id,
          body: commentBody,
          createdAt: new Date().toISOString(),
        });
        recordAudit(db, request, {
          actor: currentUser,
          action: 'task.comment.create',
          targetType: 'task',
          targetId: taskId,
          detail: { roomId },
        });
        sendJson(response, 201, { comment });
        return;
      }
    }

    // /api/rooms/:id/tasks/:taskId/comments/:commentId
    if (pathParts.length === 7 && pathParts[3] === 'tasks' && pathParts[5] === 'comments') {
      const taskId = decodeURIComponent(pathParts[4]);
      const existing = db.findTask(roomId, taskId);
      if (!existing) throw new ApiError(404, '업무를 찾을 수 없습니다.');

      if (method === 'DELETE') {
        const comment = db.findComment(Number(pathParts[6]));
        if (!comment || comment.task_id !== taskId) throw new ApiError(404, '댓글을 찾을 수 없습니다.');
        if (currentUser.role !== 'admin' && comment.author_id !== currentUser.id) {
          throw new ApiError(403, '댓글 삭제 권한이 없습니다.');
        }
        db.deleteComment(comment.id);
        recordAudit(db, request, {
          actor: currentUser,
          action: 'task.comment.delete',
          targetType: 'task',
          targetId: taskId,
          detail: { roomId, commentId: comment.id },
        });
        sendNoContent(response);
        return;
      }
    }
    if (pathParts.length === 5 && pathParts[3] === 'tasks') {
      const taskId = decodeURIComponent(pathParts[4]);
      const existing = db.findTask(roomId, taskId);

      if (!existing) {
        throw new ApiError(404, '업무를 찾을 수 없습니다.');
      }

      if (method === 'PATCH') {
        const body = await readJsonBody(request);
        let nextAssignee = null;
        if ('assignee' in body && !('assigneeId' in body)) {
          throw new ApiError(400, '담당자 변경은 assigneeId로 요청해야 합니다.');
        }
        if ('assigneeId' in body) {
          if (currentUser.role !== 'admin' && currentUser.role !== 'leader') {
            throw new ApiError(403, '담당자 재배정 권한이 없습니다.');
          }
          const assignee = db.findUserById(Number(body.assigneeId));
          if (!assignee || !db.isMember(roomId, assignee.id)) {
            throw new ApiError(400, '담당자는 팀원 중에서 선택해야 합니다.');
          }
          nextAssignee = assignee.name;
        }
        const fields = buildTaskUpdate(body);
        if (nextAssignee) {
          fields.assignee = nextAssignee;
        }
        const task = db.updateTask(taskId, fields);
        recordAudit(db, request, {
          actor: currentUser,
          action: 'task.update',
          targetType: 'task',
          targetId: task.id,
          detail: { roomId, changes: buildChangeDetail(existing, fields) },
        });
        if (fields.assignee && fields.assignee !== existing.assignee) {
          recordAudit(db, request, {
            actor: currentUser,
            action: 'task.assignee.update',
            targetType: 'task',
            targetId: task.id,
            detail: { roomId, from: existing.assignee, to: task.assignee },
          });
          notifyAssignee(db, task, currentUser);
        }
        sendJson(response, 200, { task });
        return;
      }

      if (method === 'DELETE') {
        db.deleteTask(taskId);
        recordAudit(db, request, {
          actor: currentUser,
          action: 'task.delete',
          targetType: 'task',
          targetId: taskId,
          detail: { roomId, title: existing.title },
        });
        sendNoContent(response);
        return;
      }
    }
  }

  sendJson(response, 404, { error: '요청한 API를 찾을 수 없습니다.' });
};

export const createApiServer = (db = openDatabase(':memory:')) =>
  createServer((request, response) => {
    handleRequest(request, response, db).catch((error) => {
      if (error instanceof ApiError) {
        sendJson(response, error.status, { error: error.message }, error.headers);
        return;
      }

      console.error(error);
      sendJson(response, 500, { error: '서버 오류가 발생했습니다.' });
    });
  });

const isDirectRun = () => {
  if (!process.argv[1]) {
    return false;
  }

  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
};

if (isDirectRun()) {
  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);
  const server = createApiServer(openDatabase());

  server.listen(port, () => {
    console.log(`API server listening on http://localhost:${port}`);
  });
}
