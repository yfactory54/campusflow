import assert from 'node:assert/strict';
import { test } from 'node:test';
// 시드 비밀번호를 결정적으로 고정(시드는 createApiServer 호출 시 실행되므로 여기서 설정하면 충분).
process.env.ADMIN_PASSWORD = 'admin12345';
import { createApiServer } from './server.js';

// 시드되는 유일한 계정은 부트스트랩 관리자뿐이다(데모 회원·팀 없음, db.js 참고).
const ADMIN = { email: 'admin@example.com', password: 'admin12345', name: '관리자' };

const startTestServer = async () => {
  const server = createApiServer();

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
    password: 'memberpw1',
    role: 'member',
  });
  const memberToken = await login(baseUrl, { email: 'member@example.com', password: 'memberpw1' });

  const created = await requestJson(baseUrl, '/api/admin/users', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: '신입사원',
      email: 'newbie@example.com',
      password: 'newbiepass1',
      role: 'member',
    }),
  });

  assert.equal(created.response.status, 201);
  assert.equal(created.body.user.email, 'newbie@example.com');
  assert.equal(created.body.user.role, 'member');
  assert.equal(created.body.user.isActive, true);

  // 새 계정으로 로그인 가능해야 한다.
  const newbieToken = await login(baseUrl, { email: 'newbie@example.com', password: 'newbiepass1' });
  assert.equal(typeof newbieToken, 'string');

  // 일반 회원은 관리자 엔드포인트 접근 불가(403).
  const forbidden = await requestJson(baseUrl, '/api/admin/users', {
    method: 'POST',
    token: memberToken,
    body: JSON.stringify({
      name: '몰래가입',
      email: 'sneaky@example.com',
      password: 'sneakypass1',
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
    password: 'memberpw1',
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
  const memberToken = await login(baseUrl, { email: 'member@example.com', password: 'memberpw1' });
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
    password: 'norooms12',
  });
  const newbieToken = await login(baseUrl, { email: 'noroom@example.com', password: 'norooms12' });
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
    password: 'memberpw1',
    role: 'member',
  });
  const memberToken = await login(baseUrl, { email: 'member@example.com', password: 'memberpw1' });
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
    password: 'leaderpw1',
    role: 'leader',
  });
  const leaderToken = await login(baseUrl, { email: 'leader@example.com', password: 'leaderpw1' });
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
