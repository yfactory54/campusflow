import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './errors.js';
import { openDatabase } from './db.js';
import {
  assertRoomAccess,
  hashPassword,
  requireAdmin,
  requireAuth,
  signToken,
  verifyPassword,
} from './auth.js';

const serviceName = 'react-class-api';
const allowedCategories = new Set(['assignment', 'exam', 'team-project', 'study']);
const allowedPriorities = new Set(['low', 'medium', 'high']);
const allowedStatuses = new Set(['todo', 'inProgress', 'done']);
const allowedRoles = new Set(['admin', 'leader', 'member']);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// OpenAI 호환 LLM 설정 — AI 기여도 분석 기능을 쓰려면 LLM_BASE_URL 을 .env 로 지정하세요.
// (기본값은 로컬 플레이스홀더이며, 미설정 시 기여도 분석 호출은 실패합니다.)
const LLM_BASE_URL = process.env.LLM_BASE_URL ?? 'http://localhost:8000/v1';
const LLM_MODEL = process.env.LLM_MODEL ?? 'gpt-4o-mini';
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 90_000);

const statusLabels = { todo: '할 일', inProgress: '진행 중', done: '완료' };
const priorityLabels = { low: '낮음', medium: '보통', high: '높음' };

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
};

const sendJson = (response, status, payload) => {
  const body = JSON.stringify(payload);

  response.writeHead(status, {
    ...corsHeaders,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
};

const sendNoContent = (response) => {
  response.writeHead(204, corsHeaders);
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

  // assignee 는 담당자 불변 정책에 따라 무시한다.
  return fields;
};

const handleLogin = async (request, response, db) => {
  const body = await readJsonBody(request);
  const email = toTrimmedString(body.email);
  const password = toTrimmedString(body.password);

  if (!emailPattern.test(email) || password.length < 8) {
    throw new ApiError(400, '유효한 이메일과 8자 이상의 비밀번호가 필요합니다.');
  }

  const user = db.findUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
    throw new ApiError(401, '이메일 또는 비밀번호가 올바르지 않습니다.');
  }
  if (!user.isActive) {
    throw new ApiError(403, '비활성화된 계정입니다. 관리자에게 문의하세요.');
  }

  sendJson(response, 200, {
    token: signToken(user),
    user: publicUser(user),
  });
};

// ---- 관리자 전용 사용자 관리 ----

const handleAdminRoutes = async (request, response, db, pathParts, method) => {
  requireAdmin(request, db);

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
      if (password.length < 8) {
        throw new ApiError(400, '비밀번호는 8자 이상이어야 합니다.');
      }
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
      if (password.length < 8) {
        throw new ApiError(400, '비밀번호는 8자 이상이어야 합니다.');
      }
      const { hash, salt } = hashPassword(password);
      db.updatePassword(userId, hash, salt);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (action === 'role' && method === 'PATCH') {
      if (!allowedRoles.has(body.role)) {
        throw new ApiError(400, '권한 값이 올바르지 않습니다.');
      }
      db.updateRole(userId, body.role);
      sendJson(response, 200, { user: db.findUserById(userId) });
      return;
    }

    if (action === 'active' && method === 'PATCH') {
      if (typeof body.isActive !== 'boolean') {
        throw new ApiError(400, '활성 여부(isActive)는 boolean 이어야 합니다.');
      }
      db.setActive(userId, body.isActive);
      sendJson(response, 200, { user: db.findUserById(userId) });
      return;
    }
  }

  sendJson(response, 404, { error: '요청한 API를 찾을 수 없습니다.' });
};

const normalizeTasksInput = (value) => {
  if (!Array.isArray(value)) {
    throw new ApiError(400, '업무 목록(tasks)이 필요합니다.');
  }

  return value.filter(isRecord).map((task) => ({
    title: toTrimmedString(task.title),
    assignee: toTrimmedString(task.assignee),
    status: allowedStatuses.has(task.status) ? task.status : 'todo',
    priority: allowedPriorities.has(task.priority) ? task.priority : 'medium',
    category: toTrimmedString(task.category),
    dueDate: toTrimmedString(task.dueDate),
  }));
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
    members: analyzedMembers,
    summary: toTrimmedString(parsed.summary),
  };
};

const handleRequest = async (request, response, db) => {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://localhost');
  const pathParts = url.pathname.split('/').filter(Boolean);

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

  if (pathParts.length === 2 && pathParts[1] === 'users' && method === 'GET') {
    requireAuth(request, db);
    sendJson(response, 200, { users: db.listUsers() });
    return;
  }

  // ---- 관리자 전용 ----
  if (pathParts[1] === 'admin') {
    await handleAdminRoutes(request, response, db, pathParts, method);
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

    // /api/rooms/:id  (수정/삭제)
    if (pathParts.length === 3) {
      if (method === 'PATCH') {
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
        sendJson(response, 200, { room: db.updateRoom(roomId, fields) });
        return;
      }

      if (method === 'DELETE') {
        db.deleteRoom(roomId);
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
        const body = await readJsonBody(request);
        const userId = Number(body.userId);
        const user = db.findUserById(userId);
        if (!user) throw new ApiError(404, '사용자를 찾을 수 없습니다.');
        if (db.isMember(roomId, userId)) throw new ApiError(400, '이미 팀원입니다.');
        db.addMember(roomId, userId);
        sendJson(response, 201, { member: user });
        return;
      }
    }

    // /api/rooms/:id/members/:userId
    if (pathParts.length === 5 && pathParts[3] === 'members') {
      const userId = Number(pathParts[4]);

      if (method === 'DELETE') {
        if (!db.isMember(roomId, userId)) throw new ApiError(404, '해당 팀원을 찾을 수 없습니다.');
        db.removeMember(roomId, userId);
        sendNoContent(response);
        return;
      }
    }

    // /api/rooms/:id/contribution  (업무 목록 상태를 받아 멤버별 기여도 분석)
    if (pathParts.length === 4 && pathParts[3] === 'contribution') {
      if (method === 'POST') {
        const members = db.listMembers(roomId);
        const body = await readJsonBody(request);
        const tasks = normalizeTasksInput(body.tasks);
        const contribution = await requestContributionAnalysis(members, tasks);
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
        sendJson(response, 201, { task });
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
        const fields = buildTaskUpdate(await readJsonBody(request));
        const task = db.updateTask(taskId, fields);
        sendJson(response, 200, { task });
        return;
      }

      if (method === 'DELETE') {
        db.deleteTask(taskId);
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
        sendJson(response, error.status, { error: error.message });
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
