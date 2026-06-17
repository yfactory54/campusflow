import assert from 'node:assert/strict';
import { test } from 'node:test';
// 시드 비밀번호를 결정적으로 고정(시드는 createApiServer 호출 시 실행되므로 여기서 설정하면 충분).
process.env.ADMIN_PASSWORD = 'AdminPass123!';
import { createApiServer } from './server.js';
import { openDatabase } from './db.js';
import { resetAllLoginRates } from './auth.js';

// 시드되는 유일한 계정은 부트스트랩 관리자뿐이다(데모 회원·팀 없음, db.js 참고).
const ADMIN = { email: 'admin@example.com', password: 'AdminPass123!', name: '관리자' };

const startTestServer = async (db) => {
  resetAllLoginRates();
  const server = createApiServer(db);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
};

const requestJson = async (baseUrl, path, options = {}) => {
  const { token, ...rest } = options;
  const response = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (response.status === 204) {
    return { response, body: null };
  }

  return { response, body: await response.json() };
};

const login = async (baseUrl, { email, password }) => {
  const { body } = await requestJson(baseUrl, '/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return body.token;
};

// 관리자 권한으로 계정을 만들고 생성된 user 를 돌려준다(데모 회원이 없으므로 테스트가 직접 픽스처를 만든다).
const createUser = async (baseUrl, adminToken, user) => {
  const { response, body } = await requestJson(baseUrl, '/api/admin/users', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify(user),
  });
  assert.equal(response.status, 201);
  return body.user;
};

// 관리자 권한으로 팀을 만들고 생성된 room 을 돌려준다.
const createRoom = async (baseUrl, adminToken, room) => {
  const { response, body } = await requestJson(baseUrl, '/api/rooms', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify(room),
  });
  assert.equal(response.status, 201);
  return body.room;
};

test('health endpoint returns service status', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const { response, body } = await requestJson(baseUrl, '/api/health');

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.service, 'react-class-api');
});

test('login accepts seeded credentials and rejects invalid input', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const valid = await requestJson(baseUrl, '/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
  });

  assert.equal(valid.response.status, 200);
  assert.equal(valid.body.user.email, ADMIN.email);
  assert.equal(valid.body.user.role, 'admin');
  assert.equal(typeof valid.body.token, 'string');

  const invalidFormat = await requestJson(baseUrl, '/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'bad-email', password: 'short' }),
  });

  assert.equal(invalidFormat.response.status, 400);
  assert.equal(invalidFormat.body.error, '유효한 이메일과 8자 이상의 비밀번호가 필요합니다.');

  const wrongPassword = await requestJson(baseUrl, '/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: ADMIN.email, password: 'wrongpassword' }),
  });

  assert.equal(wrongPassword.response.status, 401);
});

test('protected routes require a valid token', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const { response, body } = await requestJson(baseUrl, '/api/rooms');

  assert.equal(response.status, 401);
  assert.equal(body.error, '인증이 필요합니다.');
});

test('rooms start empty and can be created', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const token = await login(baseUrl, ADMIN);

  // 데모 데이터가 없으므로 처음에는 팀이 하나도 없다.
  const listed = await requestJson(baseUrl, '/api/rooms', { token });
  assert.equal(listed.response.status, 200);
  assert.deepEqual(listed.body.rooms, []);

  const created = await requestJson(baseUrl, '/api/rooms', {
    method: 'POST',
    token,
    body: JSON.stringify({ name: '팀A', description: '백엔드 API 협업 팀' }),
  });

  assert.equal(created.response.status, 201);
  assert.equal(created.body.room.id, 1);
  assert.equal(created.body.room.name, '팀A');
  assert.equal(created.body.room.memberCount, 1);
  assert.equal(created.body.room.createdBy, 1);

  await createRoom(baseUrl, token, { name: '팀B' });

  const afterCreate = await requestJson(baseUrl, '/api/rooms', { token });
  assert.deepEqual(
    afterCreate.body.rooms.map((room) => room.name),
    ['팀A', '팀B'],
  );
});

test('room tasks can be created, updated, listed, and deleted', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const token = await login(baseUrl, ADMIN);
  const room = await createRoom(baseUrl, token, { name: '팀A' });

  const created = await requestJson(baseUrl, `/api/rooms/${room.id}/tasks`, {
    method: 'POST',
    token,
    body: JSON.stringify({
      title: 'API 서버 만들기',
      dueDate: '2026-05-28',
      priority: 'high',
      category: 'assignment',
      assignee: '홍길동', // 무시되고 세션 사용자 이름으로 스탬프되어야 함
      memo: 'Node 기본 http 사용',
    }),
  });

  assert.equal(created.response.status, 201);
  assert.equal(created.body.task.id, 'task-1');
  assert.equal(created.body.task.status, 'todo');
  assert.equal(created.body.task.title, 'API 서버 만들기');
  // 담당자는 클라이언트 입력('홍길동')이 아니라 로그인 세션 이름이어야 한다.
  assert.equal(created.body.task.assignee, ADMIN.name);

  const updated = await requestJson(baseUrl, `/api/rooms/${room.id}/tasks/task-1`, {
    method: 'PATCH',
    token,
    body: JSON.stringify({ status: 'done', memo: '테스트 통과 후 완료' }),
  });

  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.task.status, 'done');
  assert.equal(updated.body.task.memo, '테스트 통과 후 완료');

  const listed = await requestJson(baseUrl, `/api/rooms/${room.id}/tasks`, { token });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.tasks.length, 1);
  assert.equal(listed.body.tasks[0].status, 'done');

  const deleted = await requestJson(baseUrl, `/api/rooms/${room.id}/tasks/task-1`, {
    method: 'DELETE',
    token,
  });

  assert.equal(deleted.response.status, 204);

  const afterDelete = await requestJson(baseUrl, `/api/rooms/${room.id}/tasks`, { token });
  assert.deepEqual(afterDelete.body.tasks, []);
});

test('unknown rooms return not found for task routes', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const token = await login(baseUrl, ADMIN);
  const { response, body } = await requestJson(baseUrl, '/api/rooms/999/tasks', { token });

  assert.equal(response.status, 404);
  assert.equal(body.error, '방을 찾을 수 없습니다.');
});

test('admin can create accounts but members cannot', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const adminToken = await login(baseUrl, ADMIN);
  await createUser(baseUrl, adminToken, {
    name: '회원',
    email: 'member@example.com',
    password: 'MemberPass123!',
    role: 'member',
  });
  const memberToken = await login(baseUrl, { email: 'member@example.com', password: 'MemberPass123!' });

  const created = await requestJson(baseUrl, '/api/admin/users', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: '신입사원',
      email: 'newbie@example.com',
      password: 'NewbiePass123!',
      role: 'member',
    }),
  });

  assert.equal(created.response.status, 201);
  assert.equal(created.body.user.email, 'newbie@example.com');
  assert.equal(created.body.user.role, 'member');
  assert.equal(created.body.user.isActive, true);

  // 새 계정으로 로그인 가능해야 한다.
  const newbieToken = await login(baseUrl, { email: 'newbie@example.com', password: 'NewbiePass123!' });
  assert.equal(typeof newbieToken, 'string');

  // 일반 회원은 관리자 엔드포인트 접근 불가(403).
  const forbidden = await requestJson(baseUrl, '/api/admin/users', {
    method: 'POST',
    token: memberToken,
    body: JSON.stringify({
      name: '몰래가입',
      email: 'sneaky@example.com',
      password: 'SneakyPass123!',
    }),
  });

  assert.equal(forbidden.response.status, 403);
  assert.equal(forbidden.body.error, '관리자 권한이 필요합니다.');
});

test('members only see rooms they belong to', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const adminToken = await login(baseUrl, ADMIN);

  // 회원과 팀 2개를 만든다(관리자가 만든 팀에는 관리자가 자동 소속된다).
  const member = await createUser(baseUrl, adminToken, {
    name: '회원',
    email: 'member@example.com',
    password: 'MemberPass123!',
    role: 'member',
  });
  const roomA = await createRoom(baseUrl, adminToken, { name: '팀A' });
  await createRoom(baseUrl, adminToken, { name: '팀B' });

  // 회원을 팀A 에만 추가한다.
  const added = await requestJson(baseUrl, `/api/rooms/${roomA.id}/members`, {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({ userId: member.id }),
  });
  assert.equal(added.response.status, 201);

  // 회원은 자신이 속한 팀A 만 본다.
  const memberToken = await login(baseUrl, { email: 'member@example.com', password: 'MemberPass123!' });
  const memberRooms = await requestJson(baseUrl, '/api/rooms', { token: memberToken });
  assert.equal(memberRooms.response.status, 200);
  assert.deepEqual(
    memberRooms.body.rooms.map((room) => room.name),
    ['팀A'],
  );

  // 관리자는 전체 방을 본다.
  const adminRooms = await requestJson(baseUrl, '/api/rooms', { token: adminToken });
  assert.deepEqual(
    adminRooms.body.rooms.map((room) => room.name),
    ['팀A', '팀B'],
  );

  // 어떤 방에도 속하지 않은 새 회원은 빈 목록을 본다.
  await createUser(baseUrl, adminToken, {
    name: '무소속',
    email: 'noroom@example.com',
    password: 'NoroomPass123!',
  });
  const newbieToken = await login(baseUrl, { email: 'noroom@example.com', password: 'NoroomPass123!' });
  const newbieRooms = await requestJson(baseUrl, '/api/rooms', { token: newbieToken });
  assert.deepEqual(newbieRooms.body.rooms, []);
});

test('only admins and leaders can create teams', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const adminToken = await login(baseUrl, ADMIN);

  // 일반 회원은 팀 생성 불가(403)
  await createUser(baseUrl, adminToken, {
    name: '회원',
    email: 'member@example.com',
    password: 'MemberPass123!',
    role: 'member',
  });
  const memberToken = await login(baseUrl, { email: 'member@example.com', password: 'MemberPass123!' });
  const memberCreate = await requestJson(baseUrl, '/api/rooms', {
    method: 'POST',
    token: memberToken,
    body: JSON.stringify({ name: '회원팀' }),
  });
  assert.equal(memberCreate.response.status, 403);
  assert.equal(memberCreate.body.error, '팀을 생성할 권한이 없습니다.');

  // 관리자가 팀장 계정을 만들면 팀장은 팀을 생성할 수 있고(201), 그 팀에 자동 소속된다.
  await createUser(baseUrl, adminToken, {
    name: '팀장',
    email: 'leader@example.com',
    password: 'LeaderPass123!',
    role: 'leader',
  });
  const leaderToken = await login(baseUrl, { email: 'leader@example.com', password: 'LeaderPass123!' });
  const leaderCreate = await requestJson(baseUrl, '/api/rooms', {
    method: 'POST',
    token: leaderToken,
    body: JSON.stringify({ name: '팀장팀', description: '팀장이 만든 팀' }),
  });
  assert.equal(leaderCreate.response.status, 201);
  assert.equal(leaderCreate.body.room.name, '팀장팀');
  assert.equal(leaderCreate.body.room.memberCount, 1);

  // 생성한 팀만 팀장의 목록에 보인다(전체가 아니라).
  const leaderRooms = await requestJson(baseUrl, '/api/rooms', { token: leaderToken });
  assert.deepEqual(
    leaderRooms.body.rooms.map((room) => room.name),
    ['팀장팀'],
  );
});

test('user search is limited to admins and leaders and hides sensitive fields', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const adminToken = await login(baseUrl, ADMIN);
  await createUser(baseUrl, adminToken, {
    name: '검색회원',
    email: 'member-search@example.com',
    password: 'MemberPass123!',
    role: 'member',
  });
  await createUser(baseUrl, adminToken, {
    name: '검색팀장',
    email: 'leader-search@example.com',
    password: 'LeaderPass123!',
    role: 'leader',
  });
  const memberToken = await login(baseUrl, {
    email: 'member-search@example.com',
    password: 'MemberPass123!',
  });
  const leaderToken = await login(baseUrl, {
    email: 'leader-search@example.com',
    password: 'LeaderPass123!',
  });

  const legacyUsers = await requestJson(baseUrl, '/api/users', { token: memberToken });
  assert.equal(legacyUsers.response.status, 404);

  const forbidden = await requestJson(baseUrl, '/api/users/search?q=검색', { token: memberToken });
  assert.equal(forbidden.response.status, 403);

  const leaderSearch = await requestJson(baseUrl, '/api/users/search?q=검색', { token: leaderToken });
  assert.equal(leaderSearch.response.status, 200);
  assert.ok(leaderSearch.body.users.length >= 2);
  for (const user of leaderSearch.body.users) {
    assert.deepEqual(Object.keys(user).sort(), ['id', 'name']);
  }

  const adminSearch = await requestJson(baseUrl, '/api/users/search?q=검색', { token: adminToken });
  assert.equal(adminSearch.response.status, 200);

  const empty = await requestJson(baseUrl, '/api/users/search?q=', { token: adminToken });
  assert.deepEqual(empty.body.users, []);
});

test('room management is limited to admins leaders and room creators', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const adminToken = await login(baseUrl, ADMIN);
  const member = await createUser(baseUrl, adminToken, {
    name: '일반회원',
    email: 'member-manage@example.com',
    password: 'MemberPass123!',
    role: 'member',
  });
  const target = await createUser(baseUrl, adminToken, {
    name: '초대대상',
    email: 'target-manage@example.com',
    password: 'TargetPass123!',
    role: 'member',
  });
  const room = await createRoom(baseUrl, adminToken, { name: '관리팀' });
  await requestJson(baseUrl, `/api/rooms/${room.id}/members`, {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({ userId: member.id }),
  });

  const memberToken = await login(baseUrl, {
    email: 'member-manage@example.com',
    password: 'MemberPass123!',
  });
  const memberAdd = await requestJson(baseUrl, `/api/rooms/${room.id}/members`, {
    method: 'POST',
    token: memberToken,
    body: JSON.stringify({ userId: target.id }),
  });
  assert.equal(memberAdd.response.status, 403);
  assert.equal(memberAdd.body.error, '팀원 관리 권한이 없습니다.');

  const memberPatch = await requestJson(baseUrl, `/api/rooms/${room.id}`, {
    method: 'PATCH',
    token: memberToken,
    body: JSON.stringify({ name: '몰래수정' }),
  });
  assert.equal(memberPatch.response.status, 403);
});

test('member room creator can manage their own room', async (t) => {
  const db = openDatabase(':memory:');
  const { baseUrl, close } = await startTestServer(db);
  t.after(close);

  const adminToken = await login(baseUrl, ADMIN);
  const creator = await createUser(baseUrl, adminToken, {
    name: '생성자회원',
    email: 'creator@example.com',
    password: 'CreatorPass123!',
    role: 'member',
  });
  const target = await createUser(baseUrl, adminToken, {
    name: '추가회원',
    email: 'add-me@example.com',
    password: 'AddMePass123!',
    role: 'member',
  });
  const adminTarget = await createUser(baseUrl, adminToken, {
    name: '관리자추가회원',
    email: 'admin-add-me@example.com',
    password: 'AdminAddPass123!',
    role: 'member',
  });

  const room = db.insertRoom({
    name: '회원생성팀',
    description: '기존 데이터 마이그레이션 호환 팀',
    createdAt: new Date().toISOString(),
    creatorId: creator.id,
  });

  const creatorToken = await login(baseUrl, {
    email: 'creator@example.com',
    password: 'CreatorPass123!',
  });
  const creatorAdd = await requestJson(baseUrl, `/api/rooms/${room.id}/members`, {
    method: 'POST',
    token: creatorToken,
    body: JSON.stringify({ userId: target.id }),
  });
  assert.equal(creatorAdd.response.status, 201);

  const creatorRemove = await requestJson(baseUrl, `/api/rooms/${room.id}/members/${target.id}`, {
    method: 'DELETE',
    token: creatorToken,
  });
  assert.equal(creatorRemove.response.status, 204);

  const adminAdd = await requestJson(baseUrl, `/api/rooms/${room.id}/members`, {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({ userId: adminTarget.id }),
  });
  assert.equal(adminAdd.response.status, 201);
});

test('audit logs login success and failure and admin can list events', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const failedLogin = await requestJson(baseUrl, '/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: ADMIN.email, password: 'wrongpassword' }),
  });
  assert.equal(failedLogin.response.status, 401);

  const adminToken = await login(baseUrl, ADMIN);
  const audit = await requestJson(baseUrl, '/api/admin/audit?limit=20', { token: adminToken });

  assert.equal(audit.response.status, 200);
  assert.ok(audit.body.total >= 2);
  assert.ok(audit.body.events.some((event) => event.action === 'login.success' && event.targetId === '1'));
  assert.ok(
    audit.body.events.some(
      (event) =>
        event.action === 'login.failure' &&
        event.targetId === ADMIN.email &&
        event.detail.reason === 'invalid_credentials',
    ),
  );
});

test('audit endpoint is admin only', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const adminToken = await login(baseUrl, ADMIN);
  await createUser(baseUrl, adminToken, {
    name: '감사조회불가회원',
    email: 'audit-member@example.com',
    password: 'MemberPass123!',
    role: 'member',
  });
  const memberToken = await login(baseUrl, {
    email: 'audit-member@example.com',
    password: 'MemberPass123!',
  });

  const forbidden = await requestJson(baseUrl, '/api/admin/audit', { token: memberToken });
  assert.equal(forbidden.response.status, 403);
});

test('password reset audit detail never contains password material', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const adminToken = await login(baseUrl, ADMIN);
  const user = await createUser(baseUrl, adminToken, {
    name: '비번초기화대상',
    email: 'reset-target@example.com',
    password: 'OldPass123!',
    role: 'member',
  });

  const reset = await requestJson(baseUrl, `/api/admin/users/${user.id}/reset-password`, {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({ password: 'NewPass123!' }),
  });
  assert.equal(reset.response.status, 200);

  const audit = await requestJson(baseUrl, '/api/admin/audit?action=user.password.reset&limit=5', {
    token: adminToken,
  });
  assert.equal(audit.response.status, 200);
  const resetEvent = audit.body.events.find((event) => event.targetId === String(user.id));
  assert.ok(resetEvent);
  const detail = JSON.stringify(resetEvent.detail);
  assert.equal(detail.includes('NewPass123!'), false);
  assert.equal(detail.includes('OldPass123!'), false);
  assert.equal(detail.includes('password'), false);
  assert.equal(detail.includes('hash'), false);
  assert.equal(detail.includes('salt'), false);
});

test('login rate limit blocks the sixth failed attempt and successful login resets earlier failures', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const adminToken = await login(baseUrl, ADMIN);
  await createUser(baseUrl, adminToken, {
    name: '레이트리밋회원',
    email: 'rate-limit@example.com',
    password: 'RateLimitPass123!',
    role: 'member',
  });
  const headers = { 'x-forwarded-for': '203.0.113.10' };

  for (let i = 0; i < 4; i += 1) {
    const failed = await requestJson(baseUrl, '/api/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'rate-limit@example.com', password: 'wrongpassword' }),
    });
    assert.equal(failed.response.status, 401);
  }

  const success = await requestJson(baseUrl, '/api/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: 'rate-limit@example.com', password: 'RateLimitPass123!' }),
  });
  assert.equal(success.response.status, 200);

  for (let i = 0; i < 5; i += 1) {
    const failed = await requestJson(baseUrl, '/api/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'rate-limit@example.com', password: 'wrongpassword' }),
    });
    assert.equal(failed.response.status, 401);
  }

  const blocked = await requestJson(baseUrl, '/api/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: 'rate-limit@example.com', password: 'wrongpassword' }),
  });
  assert.equal(blocked.response.status, 429);
  assert.ok(blocked.response.headers.get('retry-after'));
});

test('password reset invalidates existing tokens immediately', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const adminToken = await login(baseUrl, ADMIN);
  await createUser(baseUrl, adminToken, {
    name: '토큰무효화회원',
    email: 'token-version@example.com',
    password: 'OldTokenPass123!',
    role: 'member',
  });
  const memberToken = await login(baseUrl, {
    email: 'token-version@example.com',
    password: 'OldTokenPass123!',
  });
  const before = await requestJson(baseUrl, '/api/rooms', { token: memberToken });
  assert.equal(before.response.status, 200);

  const users = await requestJson(baseUrl, '/api/admin/users', { token: adminToken });
  const user = users.body.users.find((item) => item.email === 'token-version@example.com');
  const reset = await requestJson(baseUrl, `/api/admin/users/${user.id}/reset-password`, {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({ password: 'NewTokenPass123!' }),
  });
  assert.equal(reset.response.status, 200);

  const after = await requestJson(baseUrl, '/api/rooms', { token: memberToken });
  assert.equal(after.response.status, 401);
  assert.equal(after.body.error, '세션이 만료되었습니다.');
});

test('password policy rejects weak passwords and accepts strong passwords', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const adminToken = await login(baseUrl, ADMIN);
  const cases = [
    { password: 'short1!', expected: '비밀번호는 10자 이상이어야 합니다.' },
    { password: 'abcdefghij', expected: '비밀번호는 영문/숫자/특수문자 중 2종류 이상을 포함해야 합니다.' },
    { password: 'password123', expected: '흔한 비밀번호는 사용할 수 없습니다.' },
  ];

  for (const [index, item] of cases.entries()) {
    const result = await requestJson(baseUrl, '/api/admin/users', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        name: `약한비번${index}`,
        email: `weak-${index}@example.com`,
        password: item.password,
        role: 'member',
      }),
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error, item.expected);
  }

  const strong = await createUser(baseUrl, adminToken, {
    name: '강한비번',
    email: 'strong-password@example.com',
    password: 'StrongPass123!',
    role: 'member',
  });
  assert.equal(strong.email, 'strong-password@example.com');
});

test('stats, CSV export, and contribution fallback use server-side tasks', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const adminToken = await login(baseUrl, ADMIN);
  const room = await createRoom(baseUrl, adminToken, { name: '통계팀', description: 'Phase D 통계 검증' });
  const created = await requestJson(baseUrl, `/api/rooms/${room.id}/tasks`, {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      title: '실제 완료 업무',
      dueDate: '2099-12-31',
      priority: 'high',
      category: 'team-project',
      memo: 'CSV 포함',
    }),
  });
  assert.equal(created.response.status, 201);

  const updated = await requestJson(baseUrl, `/api/rooms/${room.id}/tasks/${created.body.task.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: JSON.stringify({ status: 'done' }),
  });
  assert.equal(updated.response.status, 200);

  const contribution = await requestJson(baseUrl, `/api/rooms/${room.id}/contribution`, {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      tasks: [{ title: '조작 업무', assignee: '조작 사용자', status: 'done', priority: 'high' }],
    }),
  });
  assert.equal(contribution.response.status, 200);
  assert.equal(contribution.body.contribution.source, 'fallback');
  assert.equal(contribution.body.contribution.members.some((member) => member.name === '조작 사용자'), false);
  const adminContribution = contribution.body.contribution.members.find((member) => member.name === ADMIN.name);
  assert.equal(adminContribution.assignedCount, 1);
  assert.equal(adminContribution.completedCount, 1);

  const adminStats = await requestJson(baseUrl, '/api/admin/stats', { token: adminToken });
  assert.equal(adminStats.response.status, 200);
  assert.equal(adminStats.body.stats.totalsByStatus.done, 1);
  assert.equal(adminStats.body.stats.priorityDistribution.high, 1);

  const roomStats = await requestJson(baseUrl, `/api/rooms/${room.id}/stats`, { token: adminToken });
  assert.equal(roomStats.response.status, 200);
  assert.equal(roomStats.body.stats.completionRateByRoom[0].rate, 1);

  const csvResponse = await fetch(`${baseUrl}/api/admin/export/tasks.csv`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(csvResponse.status, 200);
  assert.match(csvResponse.headers.get('content-type'), /text\/csv/);
  const csv = await csvResponse.text();
  assert.match(csv, /실제 완료 업무/);
  assert.doesNotMatch(csv, /password/i);
});

test('task reassignment is leader-only, audited, and creates notifications', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const adminToken = await login(baseUrl, ADMIN);
  const leader = await createUser(baseUrl, adminToken, {
    name: '리더D',
    email: 'phase-d-leader@example.com',
    password: 'LeaderPass123!',
    role: 'leader',
  });
  const member = await createUser(baseUrl, adminToken, {
    name: '멤버D',
    email: 'phase-d-member@example.com',
    password: 'MemberPass123!',
    role: 'member',
  });
  const leaderToken = await login(baseUrl, { email: leader.email, password: 'LeaderPass123!' });
  const memberToken = await login(baseUrl, { email: member.email, password: 'MemberPass123!' });
  const room = await createRoom(baseUrl, adminToken, { name: '재배정팀', description: 'Phase D 재배정 검증' });

  for (const user of [leader, member]) {
    const added = await requestJson(baseUrl, `/api/rooms/${room.id}/members`, {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ userId: user.id }),
    });
    assert.equal(added.response.status, 201);
  }

  const created = await requestJson(baseUrl, `/api/rooms/${room.id}/tasks`, {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      title: '재배정 대상 업무',
      dueDate: '2099-12-31',
      priority: 'medium',
      category: 'assignment',
    }),
  });
  assert.equal(created.response.status, 201);

  const directAssignee = await requestJson(baseUrl, `/api/rooms/${room.id}/tasks/${created.body.task.id}`, {
    method: 'PATCH',
    token: leaderToken,
    body: JSON.stringify({ assignee: member.name }),
  });
  assert.equal(directAssignee.response.status, 400);

  const forbidden = await requestJson(baseUrl, `/api/rooms/${room.id}/tasks/${created.body.task.id}`, {
    method: 'PATCH',
    token: memberToken,
    body: JSON.stringify({ assigneeId: leader.id }),
  });
  assert.equal(forbidden.response.status, 403);

  const reassigned = await requestJson(baseUrl, `/api/rooms/${room.id}/tasks/${created.body.task.id}`, {
    method: 'PATCH',
    token: leaderToken,
    body: JSON.stringify({ assigneeId: member.id }),
  });
  assert.equal(reassigned.response.status, 200);
  assert.equal(reassigned.body.task.assignee, member.name);

  const audit = await requestJson(baseUrl, '/api/admin/audit?action=task.assignee.update', { token: adminToken });
  assert.equal(audit.response.status, 200);
  assert.equal(audit.body.total, 1);
  assert.equal(audit.body.events[0].detail.to, member.name);

  const dueDate = new Date().toISOString().slice(0, 10);
  const dueTask = await requestJson(baseUrl, `/api/rooms/${room.id}/tasks`, {
    method: 'POST',
    token: memberToken,
    body: JSON.stringify({
      title: '마감 임박 업무',
      dueDate,
      priority: 'low',
      category: 'study',
    }),
  });
  assert.equal(dueTask.response.status, 201);

  const notifications = await requestJson(baseUrl, '/api/me/notifications?unread=1', { token: memberToken });
  assert.equal(notifications.response.status, 200);
  assert.equal(notifications.body.notifications.some((item) => item.kind === 'task.assigned'), true);
  assert.equal(notifications.body.notifications.some((item) => item.kind === 'task.due_soon'), true);

  const readAll = await requestJson(baseUrl, '/api/me/notifications/read-all', {
    method: 'POST',
    token: memberToken,
    body: JSON.stringify({}),
  });
  assert.equal(readAll.response.status, 200);
  assert.equal(readAll.body.unreadCount, 0);
});

test('task comments can be listed, created, and deleted by author or admin', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const adminToken = await login(baseUrl, ADMIN);
  const member = await createUser(baseUrl, adminToken, {
    name: '댓글멤버',
    email: 'phase-d-comment@example.com',
    password: 'CommentPass123!',
    role: 'member',
  });
  const memberToken = await login(baseUrl, { email: member.email, password: 'CommentPass123!' });
  const room = await createRoom(baseUrl, adminToken, { name: '댓글팀', description: 'Phase D 댓글 검증' });
  const added = await requestJson(baseUrl, `/api/rooms/${room.id}/members`, {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({ userId: member.id }),
  });
  assert.equal(added.response.status, 201);

  const createdTask = await requestJson(baseUrl, `/api/rooms/${room.id}/tasks`, {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      title: '댓글 대상 업무',
      dueDate: '2099-12-31',
      priority: 'medium',
      category: 'assignment',
    }),
  });
  assert.equal(createdTask.response.status, 201);

  const createdComment = await requestJson(
    baseUrl,
    `/api/rooms/${room.id}/tasks/${createdTask.body.task.id}/comments`,
    {
      method: 'POST',
      token: memberToken,
      body: JSON.stringify({ body: '진행 상황 공유합니다.' }),
    },
  );
  assert.equal(createdComment.response.status, 201);
  assert.equal(createdComment.body.comment.authorName, member.name);

  const comments = await requestJson(baseUrl, `/api/rooms/${room.id}/tasks/${createdTask.body.task.id}/comments`, {
    token: adminToken,
  });
  assert.equal(comments.response.status, 200);
  assert.equal(comments.body.comments.length, 1);

  const deleted = await requestJson(
    baseUrl,
    `/api/rooms/${room.id}/tasks/${createdTask.body.task.id}/comments/${createdComment.body.comment.id}`,
    {
      method: 'DELETE',
      token: adminToken,
    },
  );
  assert.equal(deleted.response.status, 204);

  const afterDelete = await requestJson(baseUrl, `/api/rooms/${room.id}/tasks/${createdTask.body.task.id}/comments`, {
    token: memberToken,
  });
  assert.equal(afterDelete.body.comments.length, 0);
});
test('CORS reflects allowed origins and omits disallowed origins', async (t) => {
  const previous = process.env.CORS_ORIGIN;
  process.env.CORS_ORIGIN = 'https://campusflow.example.com';
  const { baseUrl, close } = await startTestServer();
  t.after(async () => {
    if (previous == null) {
      delete process.env.CORS_ORIGIN;
    } else {
      process.env.CORS_ORIGIN = previous;
    }
    await close();
  });

  const allowed = await requestJson(baseUrl, '/api/health', {
    method: 'OPTIONS',
    headers: { origin: 'https://campusflow.example.com' },
  });
  assert.equal(allowed.response.status, 204);
  assert.equal(allowed.response.headers.get('access-control-allow-origin'), 'https://campusflow.example.com');
  assert.equal(allowed.response.headers.get('vary'), 'Origin');

  const denied = await requestJson(baseUrl, '/api/health', {
    method: 'OPTIONS',
    headers: { origin: 'https://evil.example.com' },
  });
  assert.equal(denied.response.status, 204);
  assert.equal(denied.response.headers.get('access-control-allow-origin'), null);
});
