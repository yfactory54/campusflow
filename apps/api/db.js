import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePassword, hashPassword } from './auth.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultDbPath = resolve(moduleDir, 'data', 'app.db');

// 시드(초기) 데이터. 데모 회원·팀은 두지 않고, 운영을 시작할 부트스트랩 관리자 계정만 만든다.
// 비밀번호는 하드코딩하지 않고 환경변수 또는 무작위 생성으로 결정한다.
const SEED_ADMIN_ID = 1;
const DEFAULT_ADMIN_EMAIL = 'admin@example.com';
const DEFAULT_ADMIN_NAME = '관리자';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  salt          TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin','leader','member')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS rooms (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT    PRIMARY KEY,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL,
  due_date   TEXT    NOT NULL,
  priority   TEXT    NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  status     TEXT    NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','inProgress','done')),
  category   TEXT    NOT NULL DEFAULT 'assignment' CHECK (category IN ('assignment','exam','team-project','study')),
  assignee   TEXT    NOT NULL DEFAULT '',
  memo       TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_room ON tasks(room_id);

CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`;

// ---- row -> JS 객체 매퍼 (snake_case -> camelCase, 응답 형태 유지) ----

const mapUser = (row) =>
  row
    ? {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        isActive: row.is_active === 1,
        createdAt: row.created_at,
      }
    : null;

// 비밀번호 검증용(내부 전용): 해시/솔트 포함
const mapUserWithSecret = (row) =>
  row ? { ...mapUser(row), passwordHash: row.password_hash, salt: row.salt } : null;

const mapRoom = (row) =>
  row
    ? {
        id: row.id,
        name: row.name,
        description: row.description,
        memberCount: row.memberCount ?? 0,
        createdAt: row.created_at,
      }
    : null;

const mapTask = (row) =>
  row
    ? {
        id: row.id,
        roomId: row.room_id,
        title: row.title,
        dueDate: row.due_date,
        priority: row.priority,
        status: row.status,
        category: row.category,
        assignee: row.assignee,
        memo: row.memo,
        createdAt: row.created_at,
      }
    : null;

const taskColumnByField = {
  title: 'title',
  dueDate: 'due_date',
  priority: 'priority',
  status: 'status',
  category: 'category',
  memo: 'memo',
};

// 시드 계정 비밀번호 결정: 환경변수 우선, 없으면 무작위 생성.
const resolveSeedCredentials = () => {
  const adminEmail = process.env.ADMIN_EMAIL?.trim() || DEFAULT_ADMIN_EMAIL;
  const adminName = process.env.ADMIN_NAME?.trim() || DEFAULT_ADMIN_NAME;

  const adminEnv = process.env.ADMIN_PASSWORD?.trim();
  if (adminEnv && adminEnv.length < 8) {
    throw new Error('ADMIN_PASSWORD 는 8자 이상이어야 합니다.');
  }
  const adminGenerated = !adminEnv;
  const adminPassword = adminEnv || generatePassword();

  return { adminEmail, adminName, adminPassword, adminGenerated };
};

// 무작위로 생성된 관리자 비밀번호를 최초 1회만 로그로 안내(환경변수로 지정된 값은 출력하지 않음).
const logSeedCredentials = (creds) => {
  if (!creds.adminGenerated) {
    return;
  }
  console.warn(
    [
      '',
      '════════ CampusFlow 초기 관리자 계정 (최초 1회만 표시) ════════',
      `관리자 이메일: ${creds.adminEmail}`,
      `관리자 비밀번호(자동 생성 — 지금 안전한 곳에 저장하세요): ${creds.adminPassword}`,
      '운영 시 ADMIN_PASSWORD 환경변수로 직접 지정하는 것을 권장합니다.',
      '════════════════════════════════════════════════════',
    ].join('\n'),
  );
};

const seedIfEmpty = (db) => {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (count > 0) {
    return;
  }

  const creds = resolveSeedCredentials();
  const now = new Date().toISOString();
  const insertUser = db.prepare(
    `INSERT INTO users (id, name, email, password_hash, salt, role, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
  );
  const insertCounter = db.prepare('INSERT INTO counters (name, value) VALUES (?, ?)');

  db.exec('BEGIN');
  try {
    const adminCred = hashPassword(creds.adminPassword);
    insertUser.run(
      SEED_ADMIN_ID,
      creds.adminName,
      creds.adminEmail,
      adminCred.hash,
      adminCred.salt,
      'admin',
      now,
    );
    insertCounter.run('task', 0);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  logSeedCredentials(creds);
};

// 기존 DB 마이그레이션: users.role 의 CHECK 가 leader 를 허용하지 않으면 테이블을 재생성한다.
const migrateUsersRole = (db) => {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  const sql = row?.sql ?? '';
  // CHECK 가 없거나 이미 leader 를 허용하면 마이그레이션 불필요.
  if (!sql.includes('CHECK') || sql.includes('leader')) {
    return;
  }

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE users_new (
        id            INTEGER PRIMARY KEY,
        name          TEXT    NOT NULL,
        email         TEXT    NOT NULL UNIQUE,
        password_hash TEXT    NOT NULL,
        salt          TEXT    NOT NULL,
        role          TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin','leader','member')),
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT    NOT NULL
      );
    `);
    db.exec(
      'INSERT INTO users_new SELECT id, name, email, password_hash, salt, role, is_active, created_at FROM users',
    );
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_new RENAME TO users');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  db.exec('PRAGMA foreign_keys = ON');
};

export const openDatabase = (location = process.env.DB_PATH ?? defaultDbPath) => {
  const inMemory = location === ':memory:';
  if (!inMemory) {
    mkdirSync(dirname(location), { recursive: true });
  }

  const db = new DatabaseSync(location);
  if (!inMemory) {
    db.exec('PRAGMA journal_mode = WAL');
  }
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  migrateUsersRole(db);
  seedIfEmpty(db);

  // ---- 준비된 statement (한 번 만들어 재사용) ----
  const statements = {
    listUsers: db.prepare('SELECT * FROM users ORDER BY id'),
    findUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    findUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare(
      `INSERT INTO users (name, email, password_hash, salt, role, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    ),
    updatePassword: db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?'),
    updateRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
    setActive: db.prepare('UPDATE users SET is_active = ? WHERE id = ?'),

    listRooms: db.prepare(`
      SELECT r.*, COUNT(rm.user_id) AS memberCount
      FROM rooms r
      LEFT JOIN room_members rm ON rm.room_id = r.id
      GROUP BY r.id
      ORDER BY r.id
    `),
    listRoomsForUser: db.prepare(`
      SELECT r.*, COUNT(rm.user_id) AS memberCount
      FROM rooms r
      LEFT JOIN room_members rm ON rm.room_id = r.id
      WHERE r.id IN (SELECT room_id FROM room_members WHERE user_id = ?)
      GROUP BY r.id
      ORDER BY r.id
    `),
    findRoom: db.prepare(`
      SELECT r.*, COUNT(rm.user_id) AS memberCount
      FROM rooms r
      LEFT JOIN room_members rm ON rm.room_id = r.id
      WHERE r.id = ?
      GROUP BY r.id
    `),
    insertRoom: db.prepare('INSERT INTO rooms (name, description, created_at) VALUES (?, ?, ?)'),
    deleteRoom: db.prepare('DELETE FROM rooms WHERE id = ?'),

    listMembers: db.prepare(`
      SELECT u.* FROM room_members rm
      JOIN users u ON u.id = rm.user_id
      WHERE rm.room_id = ?
      ORDER BY u.id
    `),
    isMember: db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?'),
    addMember: db.prepare('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)'),
    removeMember: db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?'),

    listTasks: db.prepare('SELECT * FROM tasks WHERE room_id = ? ORDER BY created_at DESC, rowid DESC'),
    listAllTasks: db.prepare('SELECT * FROM tasks ORDER BY created_at DESC, rowid DESC'),
    findTask: db.prepare('SELECT * FROM tasks WHERE room_id = ? AND id = ?'),
    insertTask: db.prepare(
      `INSERT INTO tasks (id, room_id, title, due_date, priority, status, category, assignee, memo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    deleteTask: db.prepare('DELETE FROM tasks WHERE id = ?'),
    findTaskById: db.prepare('SELECT * FROM tasks WHERE id = ?'),
    bumpTaskCounter: db.prepare('UPDATE counters SET value = value + 1 WHERE name = ?'),
    readTaskCounter: db.prepare('SELECT value FROM counters WHERE name = ?'),
  };

  const nextTaskId = () => {
    statements.bumpTaskCounter.run('task');
    const { value } = statements.readTaskCounter.get('task');
    return `task-${value}`;
  };

  return {
    raw: db,

    // users
    listUsers: () => statements.listUsers.all().map(mapUser),
    findUserByEmail: (email) => mapUserWithSecret(statements.findUserByEmail.get(email)),
    findUserById: (id) => mapUser(statements.findUserById.get(id)),
    insertUser: ({ name, email, passwordHash, salt, role, createdAt }) => {
      const info = statements.insertUser.run(name, email, passwordHash, salt, role, createdAt);
      return mapUser(statements.findUserById.get(Number(info.lastInsertRowid)));
    },
    updatePassword: (id, passwordHash, salt) => statements.updatePassword.run(passwordHash, salt, id),
    updateRole: (id, role) => statements.updateRole.run(role, id),
    setActive: (id, isActive) => statements.setActive.run(isActive ? 1 : 0, id),

    // rooms
    listRooms: () => statements.listRooms.all().map(mapRoom),
    listRoomsForUser: (userId) => statements.listRoomsForUser.all(userId).map(mapRoom),
    findRoom: (id) => mapRoom(statements.findRoom.get(id)),
    insertRoom: ({ name, description, createdAt, creatorId }) => {
      const info = statements.insertRoom.run(name, description, createdAt);
      const roomId = Number(info.lastInsertRowid);
      if (creatorId != null) {
        statements.addMember.run(roomId, creatorId);
      }
      return mapRoom(statements.findRoom.get(roomId));
    },
    updateRoom: (id, fields) => {
      const sets = [];
      const params = [];
      if ('name' in fields) {
        sets.push('name = ?');
        params.push(fields.name);
      }
      if ('description' in fields) {
        sets.push('description = ?');
        params.push(fields.description);
      }
      if (sets.length > 0) {
        params.push(id);
        db.prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      }
      return mapRoom(statements.findRoom.get(id));
    },
    deleteRoom: (id) => statements.deleteRoom.run(id),

    // members
    listMembers: (roomId) => statements.listMembers.all(roomId).map(mapUser),
    isMember: (roomId, userId) => Boolean(statements.isMember.get(roomId, userId)),
    addMember: (roomId, userId) => statements.addMember.run(roomId, userId),
    removeMember: (roomId, userId) => statements.removeMember.run(roomId, userId),

    // tasks
    listTasks: (roomId) => statements.listTasks.all(roomId).map(mapTask),
    listAllTasks: () => statements.listAllTasks.all().map(mapTask),
    findTask: (roomId, taskId) => mapTask(statements.findTask.get(roomId, taskId)),
    findTaskById: (taskId) => mapTask(statements.findTaskById.get(taskId)),
    insertTask: ({ roomId, title, dueDate, priority, status, category, assignee, memo, createdAt }) => {
      const id = nextTaskId();
      statements.insertTask.run(
        id,
        roomId,
        title,
        dueDate,
        priority,
        status,
        category,
        assignee,
        memo,
        createdAt,
      );
      return mapTask(statements.findTaskById.get(id));
    },
    updateTask: (taskId, fields) => {
      const sets = [];
      const params = [];
      for (const [field, column] of Object.entries(taskColumnByField)) {
        if (field in fields) {
          sets.push(`${column} = ?`);
          params.push(fields[field]);
        }
      }
      if (sets.length > 0) {
        params.push(taskId);
        db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      }
      return mapTask(statements.findTaskById.get(taskId));
    },
    deleteTask: (taskId) => statements.deleteTask.run(taskId),
  };
};
