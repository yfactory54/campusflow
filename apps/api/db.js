import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePassword, hashPassword, validatePasswordStrength } from './auth.js';

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
  token_version INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS rooms (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  created_by  INTEGER REFERENCES users(id)
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

CREATE TABLE IF NOT EXISTS task_comments (
  id         INTEGER PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id, id);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id   TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL,
  read_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_unique_unread ON notifications(user_id, kind, target_type, target_id, message) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_room ON tasks(room_id);

CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER,
  actor_name  TEXT NOT NULL DEFAULT '',
  actor_role  TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id   TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_events(target_type, target_id);
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
        tokenVersion: row.token_version ?? 1,
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
        createdBy: row.created_by ?? null,
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
const mapTaskComment = (row) =>
  row
    ? {
        id: row.id,
        taskId: row.task_id,
        authorId: row.author_id,
        authorName: row.author_name ?? '',
        body: row.body,
        createdAt: row.created_at,
      }
    : null;

const mapNotification = (row) =>
  row
    ? {
        id: row.id,
        userId: row.user_id,
        kind: row.kind,
        targetType: row.target_type,
        targetId: row.target_id,
        message: row.message,
        readAt: row.read_at,
        createdAt: row.created_at,
      }
    : null;

const createEmptyStats = () => ({
  totalsByStatus: { todo: 0, inProgress: 0, done: 0 },
  completionRateByRoom: [],
  completionRateByUser: [],
  overdueTasks: [],
  priorityDistribution: { low: 0, medium: 0, high: 0 },
});

const buildStats = (rooms, tasks) => {
  const stats = createEmptyStats();
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const userTotals = new Map();
  const today = new Date().toISOString().slice(0, 10);

  for (const task of tasks) {
    stats.totalsByStatus[task.status] += 1;
    stats.priorityDistribution[task.priority] += 1;

    const user = userTotals.get(task.assignee) ?? { name: task.assignee || '미지정', completed: 0, total: 0 };
    user.total += 1;
    if (task.status === 'done') user.completed += 1;
    userTotals.set(task.assignee, user);

    if (task.status !== 'done' && task.dueDate < today) {
      stats.overdueTasks.push({
        id: task.id,
        roomId: task.roomId,
        roomName: roomById.get(task.roomId)?.name ?? '',
        title: task.title,
        dueDate: task.dueDate,
        assignee: task.assignee,
      });
    }
  }

  stats.completionRateByRoom = rooms.map((room) => {
    const roomTasks = tasks.filter((task) => task.roomId === room.id);
    const done = roomTasks.filter((task) => task.status === 'done').length;
    return {
      roomId: room.id,
      name: room.name,
      completed: done,
      total: roomTasks.length,
      rate: roomTasks.length ? done / roomTasks.length : 0,
    };
  });

  stats.completionRateByUser = [...userTotals.values()].sort((left, right) => right.total - left.total);
  return stats;
};


const parseAuditDetail = (value) => {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const mapAuditEvent = (row) =>
  row
    ? {
        id: row.id,
        actorId: row.actor_id ?? null,
        actorName: row.actor_name,
        actorRole: row.actor_role,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        detail: parseAuditDetail(row.detail),
        ip: row.ip,
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
  assignee: 'assignee',
};
const escapeLike = (value) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

// 시드 계정 비밀번호 결정: 환경변수 우선, 없으면 무작위 생성.
const resolveSeedCredentials = () => {
  const adminEmail = process.env.ADMIN_EMAIL?.trim() || DEFAULT_ADMIN_EMAIL;
  const adminName = process.env.ADMIN_NAME?.trim() || DEFAULT_ADMIN_NAME;

  const adminEnv = process.env.ADMIN_PASSWORD?.trim();
  if (adminEnv) {
    validatePasswordStrength(adminEnv);
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
    `INSERT INTO users (id, name, email, password_hash, salt, role, token_version, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)`,
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
        token_version INTEGER NOT NULL DEFAULT 1,
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT    NOT NULL
      );
    `);
    db.exec(
      'INSERT INTO users_new (id, name, email, password_hash, salt, role, is_active, created_at) SELECT id, name, email, password_hash, salt, role, is_active, created_at FROM users',
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

// 기존 DB 마이그레이션: rooms.created_by 가 없으면 nullable 컬럼을 추가한다.
const migrateRoomsCreatedBy = (db) => {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='rooms'").get();
  const sql = row?.sql ?? '';
  if (sql.includes('created_by')) {
    return;
  }

  db.exec('ALTER TABLE rooms ADD COLUMN created_by INTEGER');
};

const migrateUsersTokenVersion = (db) => {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  const sql = row?.sql ?? '';
  if (sql.includes('token_version')) {
    return;
  }

  db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1');
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
  migrateRoomsCreatedBy(db);
  migrateUsersTokenVersion(db);
  seedIfEmpty(db);

  // ---- 준비된 statement (한 번 만들어 재사용) ----
  const statements = {
    listUsers: db.prepare('SELECT * FROM users ORDER BY id'),
    searchActiveUsersByName: db.prepare(`
      SELECT id, name
      FROM users
      WHERE is_active = 1 AND name LIKE ? ESCAPE '\\'
      ORDER BY name, id
      LIMIT ?
    `),
    findUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    findUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare(
      `INSERT INTO users (name, email, password_hash, salt, role, token_version, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?)`,
    ),
    updatePassword: db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?'),
    updateRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
    setActive: db.prepare('UPDATE users SET is_active = ? WHERE id = ?'),
    bumpTokenVersion: db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?'),

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
    insertRoom: db.prepare('INSERT INTO rooms (name, description, created_at, created_by) VALUES (?, ?, ?, ?)'),
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
    listUsersByNames: db.prepare(
      `SELECT id, name FROM users
       WHERE is_active = 1 AND name IN (SELECT value FROM json_each(?))`,
    ),
    insertComment: db.prepare(
      `INSERT INTO task_comments (task_id, author_id, body, created_at)
       VALUES (?, ?, ?, ?)`,
    ),
    listComments: db.prepare(`
      SELECT c.*, u.name AS author_name
      FROM task_comments c
      JOIN users u ON u.id = c.author_id
      WHERE c.task_id = ?
      ORDER BY c.id
    `),
    findComment: db.prepare('SELECT * FROM task_comments WHERE id = ?'),
    deleteComment: db.prepare('DELETE FROM task_comments WHERE id = ?'),
    insertNotification: db.prepare(
      `INSERT OR IGNORE INTO notifications
       (user_id, kind, target_type, target_id, message, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    ),
    listNotifications: db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ? AND (? = 0 OR read_at IS NULL)
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `),
    unreadNotificationCount: db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL'),
    markNotificationRead: db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?'),
    markAllNotificationsRead: db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL'),

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
    insertAuditEvent: db.prepare(
      `INSERT INTO audit_events
       (actor_id, actor_name, actor_role, action, target_type, target_id, detail, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
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
    searchActiveUsersByName: (query, limit = 20) =>
      statements.searchActiveUsersByName.all(`%${escapeLike(query)}%`, limit).map((row) => ({
        id: row.id,
        name: row.name,
      })),
    findUserByEmail: (email) => mapUserWithSecret(statements.findUserByEmail.get(email)),
    findUserById: (id) => mapUser(statements.findUserById.get(id)),
    insertUser: ({ name, email, passwordHash, salt, role, createdAt }) => {
      const info = statements.insertUser.run(name, email, passwordHash, salt, role, createdAt);
      return mapUser(statements.findUserById.get(Number(info.lastInsertRowid)));
    },
    updatePassword: (id, passwordHash, salt) => statements.updatePassword.run(passwordHash, salt, id),
    updateRole: (id, role) => statements.updateRole.run(role, id),
    setActive: (id, isActive) => statements.setActive.run(isActive ? 1 : 0, id),
    bumpTokenVersion: (id) => statements.bumpTokenVersion.run(id),

    // rooms
    listRooms: () => statements.listRooms.all().map(mapRoom),
    listRoomsForUser: (userId) => statements.listRoomsForUser.all(userId).map(mapRoom),
    findRoom: (id) => mapRoom(statements.findRoom.get(id)),
    insertRoom: ({ name, description, createdAt, creatorId }) => {
      const info = statements.insertRoom.run(name, description, createdAt, creatorId ?? null);
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

    findUsersByNames: (names) =>
      names.length ? statements.listUsersByNames.all(JSON.stringify([...new Set(names)])) : [],
    stats: () => buildStats(statements.listRooms.all().map(mapRoom), statements.listAllTasks.all().map(mapTask)),
    statsByRoom: (roomId) => {
      const room = mapRoom(statements.findRoom.get(roomId));
      return room ? buildStats([room], statements.listTasks.all(roomId).map(mapTask)) : createEmptyStats();
    },

    // comments
    listComments: (taskId) => statements.listComments.all(taskId).map(mapTaskComment),
    findComment: (id) => statements.findComment.get(id),
    insertComment: ({ taskId, authorId, body, createdAt }) => {
      const info = statements.insertComment.run(taskId, authorId, body, createdAt);
      return mapTaskComment(statements.listComments.all(taskId).find((comment) => comment.id === Number(info.lastInsertRowid)));
    },
    deleteComment: (id) => statements.deleteComment.run(id),

    // notifications
    insertNotification: ({ userId, kind, targetType, targetId, message, createdAt }) =>
      statements.insertNotification.run(userId, kind, targetType, String(targetId ?? ''), message, createdAt),
    listNotifications: ({ userId, unread = false, limit = 20 }) =>
      statements.listNotifications.all(userId, unread ? 1 : 0, limit).map(mapNotification),
    unreadNotificationCount: (userId) => statements.unreadNotificationCount.get(userId).count,
    markNotificationRead: (id, userId, readAt) => statements.markNotificationRead.run(readAt, id, userId),
    markAllNotificationsRead: (userId, readAt) => statements.markAllNotificationsRead.run(readAt, userId),

    // audit
    insertAuditEvent: ({ actor = null, action, targetType = '', targetId = '', detail = {}, ip = '' }) =>
      statements.insertAuditEvent.run(
        actor?.id ?? null,
        actor?.name ?? '',
        actor?.role ?? '',
        action,
        targetType,
        String(targetId ?? ''),
        JSON.stringify(detail ?? {}),
        ip,
        new Date().toISOString(),
      ),
    listAuditEvents: ({ limit = 50, offset = 0, action = '', actorId = null, since = '' } = {}) => {
      const where = [];
      const params = [];
      if (action) {
        where.push('action = ?');
        params.push(action);
      }
      if (actorId != null) {
        where.push('actor_id = ?');
        params.push(actorId);
      }
      if (since) {
        where.push('created_at >= ?');
        params.push(since);
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = db.prepare(`SELECT COUNT(*) AS count FROM audit_events ${whereSql}`).get(...params).count;
      const events = db
        .prepare(
          `SELECT * FROM audit_events ${whereSql}
           ORDER BY created_at DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset)
        .map(mapAuditEvent);

      return { events, total };
    },
  };
};
