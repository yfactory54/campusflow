import { useEffect, useState } from "react";
import useFetch from "../fetch/useFetch";
import type { AuthUser, ManagedUser, UserRole } from "../types/user";
import type { Task } from "../types/task";
import { priorityLabels, statusLabels } from "../utils/utils";

interface Room {
  id: number;
  name: string;
  description: string;
  memberCount: number;
  createdBy: number | null;
}

interface AuditEvent {
  id: number;
  actorId: number | null;
  actorName: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown>;
  ip: string;
  createdAt: string;
}

interface AuditResponse {
  events: AuditEvent[];
  total: number;
}

interface StatsResponse {
  stats: {
    totalsByStatus: Record<string, number>;
    completionRateByRoom: Array<{ roomId: number; name: string; completed: number; total: number; rate: number }>;
    completionRateByUser: Array<{ name: string; completed: number; total: number }>;
    overdueTasks: Array<{ id: string; title: string; roomName: string; dueDate: string; assignee: string }>;
    priorityDistribution: Record<string, number>;
  };
}

interface AdminPanelProps {
  currentUser: AuthUser;
  onClose: () => void;
}

const emptyNewUser = { name: "", email: "", password: "", role: "member" as UserRole };
const auditLimit = 20;
const roleLabels: Record<UserRole, string> = { admin: "관리자", leader: "팀장", member: "회원" };
const tabLabels = { users: "사용자", rooms: "팀·업무", stats: "통계", audit: "감사 로그" } as const;
const actionOptions = [
  "login.success",
  "login.failure",
  "user.create",
  "user.role.update",
  "user.active.update",
  "user.password.reset",
  "user.password.change",
  "user.session.revoke",
  "room.create",
  "room.update",
  "room.delete",
  "room.member.add",
  "room.member.remove",
  "task.create",
  "task.update",
  "task.delete",
  "task.assignee.update",
  "task.comment.create",
  "task.comment.delete",
];

type AdminTab = keyof typeof tabLabels;

const formatDateTime = (value: string) => new Date(value).toLocaleString("ko-KR");
const formatDetail = (value: Record<string, unknown>) => JSON.stringify(value, null, 2);

export default function AdminPanel({ currentUser, onClose }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>("users");
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [roomTasks, setRoomTasks] = useState<Task[]>([]);
  const [newUser, setNewUser] = useState(emptyNewUser);
  const [formError, setFormError] = useState("");
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditFilters, setAuditFilters] = useState({ action: "", actorId: "", since: "" });
  const [expandedAuditIds, setExpandedAuditIds] = useState<Set<number>>(new Set());
  const [stats, setStats] = useState<StatsResponse["stats"] | null>(null);

  const { request: fetchUsers } = useFetch<{ users: ManagedUser[] }>();
  const { request: fetchRooms } = useFetch<{ rooms: Room[] }>();
  const { request: fetchTasks } = useFetch<{ tasks: Task[] }>();
  const { request: fetchAudit, loading: auditLoading, error: auditError } = useFetch<AuditResponse>();
  const { request: fetchStats } = useFetch<StatsResponse>();
  const { request: createUser, loading: creating, error: createError } = useFetch<{ user: ManagedUser }>();
  const { request: patchUser } = useFetch<{ user: ManagedUser }>();
  const { request: mutate } = useFetch();

  const buildAuditPath = (offset: number) => {
    const params = new URLSearchParams({ limit: String(auditLimit), offset: String(offset) });
    if (auditFilters.action) params.set("action", auditFilters.action);
    if (auditFilters.actorId) params.set("actorId", auditFilters.actorId);
    if (auditFilters.since) params.set("since", new Date(auditFilters.since).toISOString());
    return `admin/audit?${params.toString()}`;
  };

  const loadStats = async () => {
    const result = await fetchStats("admin/stats");
    if (result.ok && result.data?.stats) setStats(result.data.stats);
  };

  const loadAudit = async (offset = auditOffset) => {
    const result = await fetchAudit(buildAuditPath(offset));
    if (result.ok && result.data) {
      setAuditEvents(result.data.events);
      setAuditTotal(result.data.total);
      setAuditOffset(offset);
      setExpandedAuditIds(new Set());
    }
  };

  const loadUsers = async () => {
    const result = await fetchUsers("admin/users");
    if (result.ok && result.data?.users) setUsers(result.data.users);
  };

  const loadRooms = async () => {
    const result = await fetchRooms("rooms");
    if (result.ok && result.data?.rooms) setRooms(result.data.rooms);
  };

  useEffect(() => {
    const load = async () => {
      const [usersData, roomsData, auditData, statsData] = await Promise.all([
        fetchUsers("admin/users"),
        fetchRooms("rooms"),
        fetchAudit(`admin/audit?limit=${auditLimit}&offset=0`),
        fetchStats("admin/stats"),
      ]);
      if (usersData.ok && usersData.data?.users) setUsers(usersData.data.users);
      if (roomsData.ok && roomsData.data?.rooms) setRooms(roomsData.data.rooms);
      if (auditData.ok && auditData.data) {
        setAuditEvents(auditData.data.events);
        setAuditTotal(auditData.data.total);
      }
      if (statsData.ok && statsData.data?.stats) setStats(statsData.data.stats);
    };
    load();
  }, [fetchUsers, fetchRooms, fetchAudit, fetchStats]);

  const handleSelectRoom = async (room: Room) => {
    setSelectedRoom(room);
    const result = await fetchTasks(`rooms/${room.id}/tasks`);
    setRoomTasks(result.ok ? result.data?.tasks ?? [] : []);
  };

  const handleCreateUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (!newUser.name.trim() || !newUser.email.trim()) {
      setFormError("이름과 이메일을 입력하세요.");
      return;
    }
    if (newUser.password.length < 8) {
      setFormError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    const result = await createUser("admin/users", {
      method: "POST",
      body: {
        name: newUser.name.trim(),
        email: newUser.email.trim(),
        password: newUser.password,
        role: newUser.role,
      },
    });
    if (result.ok && result.data?.user) {
      setNewUser(emptyNewUser);
      loadUsers();
      loadAudit(0);
    }
  };

  const handleSetRole = async (user: ManagedUser, role: UserRole) => {
    if (role === user.role) return;
    const result = await patchUser(`admin/users/${user.id}/role`, {
      method: "PATCH",
      body: { role },
    });
    if (result.ok && result.data?.user) {
      loadUsers();
      loadAudit(0);
    }
  };

  const handleToggleActive = async (user: ManagedUser) => {
    const result = await patchUser(`admin/users/${user.id}/active`, {
      method: "PATCH",
      body: { isActive: !user.isActive },
    });
    if (result.ok && result.data?.user) {
      loadUsers();
      loadAudit(0);
    }
  };

  const handleResetPassword = async (user: ManagedUser) => {
    const password = window.prompt(`${user.name}님의 새 비밀번호 (10자 이상, 영문/숫자/특수문자 중 2종류 이상)`);
    if (!password) return;
    const result = await mutate(`admin/users/${user.id}/reset-password`, {
      method: "POST",
      body: { password },
    });
    if (result.ok) {
      alert("비밀번호가 변경되었습니다.");
      loadAudit(0);
    }
  };

  const handleLogoutAllUser = async (user: ManagedUser) => {
    if (!confirm(`${user.name}님의 모든 세션을 종료하시겠습니까?`)) return;
    const result = await mutate(`admin/users/${user.id}/logout-all`, { method: "POST" });
    if (result.ok) {
      alert("모든 세션을 종료했습니다.");
      loadAudit(0);
    }
  };

  const handleDeleteRoom = async (room: Room) => {
    if (!confirm(`'${room.name}' 팀을 삭제하시겠습니까? 소속 업무도 함께 삭제됩니다.`)) return;
    const result = await mutate(`rooms/${room.id}`, { method: "DELETE" });
    if (!result.ok) return;
    if (selectedRoom?.id === room.id) {
      setSelectedRoom(null);
      setRoomTasks([]);
    }
    loadRooms();
    loadAudit(0);
  };

  const handleDeleteTask = async (task: Task) => {
    if (!selectedRoom) return;
    if (!confirm(`'${task.title}' 업무를 삭제하시겠습니까?`)) return;
    const result = await mutate(`rooms/${selectedRoom.id}/tasks/${task.id}`, { method: "DELETE" });
    if (!result.ok) return;
    setRoomTasks((tasks) => tasks.filter((item) => item.id !== task.id));
    loadAudit(0);
  };

  const handleDownloadCsv = async (kind: "tasks" | "users") => {
    const token = localStorage.getItem("authToken");
    const response = await fetch(`/api/admin/export/${kind}.csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${kind}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleAuditFilterSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    loadAudit(0);
  };

  const toggleAuditDetail = (eventId: number) => {
    setExpandedAuditIds((current) => {
      const next = new Set(current);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
      <div className="w-full max-w-[960px] rounded-xl border border-gray-200 bg-white p-6 sm:p-8">
        <div className="mb-6 flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h1 className="m-0 font-display text-[22px] font-extrabold text-gray-800">관리자 패널</h1>
            <p className="mt-1 text-xs text-slate-500">사용자 계정, 전체 팀·업무, 감사 로그를 관리합니다.</p>
          </div>
          <button type="button" className="btn secondary shrink-0" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {(Object.keys(tabLabels) as AdminTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`btn toggle ${activeTab === tab ? "primary" : "secondary"}`}
              onClick={() => setActiveTab(tab)}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>

        {activeTab === "users" && (
          <>
            <section className="mt-5">
              <h3 className="m-0 mb-3 text-[15px] font-bold text-ink">계정 생성</h3>
              <form className="mb-6 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4" onSubmit={handleCreateUser}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input
                    className="control"
                    placeholder="이름"
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  />
                  <input
                    className="control"
                    placeholder="이메일"
                    type="email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input
                    className="control"
                    placeholder="비밀번호 (10자 이상, 2종류 이상)"
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  />
                  <select
                    className="control"
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                  >
                    <option value="member">일반 회원</option>
                    <option value="leader">팀장</option>
                    <option value="admin">관리자</option>
                  </select>
                </div>
                {(formError || createError) && <p className="message error">{formError || createError}</p>}
                <button type="submit" className="btn primary w-full" disabled={creating}>
                  {creating ? "생성 중..." : "계정 생성"}
                </button>
              </form>
            </section>

            <section className="mt-5">
              <h3 className="m-0 mb-3 text-[15px] font-bold text-ink">사용자 목록 ({users.length}명)</h3>
              <ul className="m-0 grid list-none gap-2 p-0">
                {users.map((user) => (
                  <li key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-bold text-ink">
                        {user.name}
                        {user.role !== "member" && <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-[3px] text-[11px] text-slate-600">{roleLabels[user.role]}</span>}
                        {!user.isActive && <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-[3px] text-[11px] text-slate-600">비활성</span>}
                      </span>
                      <span className="text-xs text-muted [overflow-wrap:anywhere]">{user.email}</span>
                    </div>
                    <div className="flex flex-shrink-0 flex-wrap justify-end gap-1.5">
                      <select
                        className="admin-select"
                        value={user.role}
                        onChange={(e) => handleSetRole(user, e.target.value as UserRole)}
                        disabled={String(user.id) === String(currentUser.id)}
                        aria-label="권한"
                      >
                        <option value="member">회원</option>
                        <option value="leader">팀장</option>
                        <option value="admin">관리자</option>
                      </select>
                      <button type="button" className="admin-btn" onClick={() => handleResetPassword(user)}>
                        비번 초기화
                      </button>
                      <button type="button" className="admin-btn" onClick={() => handleLogoutAllUser(user)}>
                        세션 종료
                      </button>
                      <button
                        type="button"
                        className={`admin-btn ${user.isActive ? "danger" : ""}`}
                        onClick={() => handleToggleActive(user)}
                        disabled={String(user.id) === String(currentUser.id)}
                      >
                        {user.isActive ? "비활성화" : "활성화"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        {activeTab === "rooms" && (
          <>
            <section className="mt-5">
              <h3 className="m-0 mb-3 text-[15px] font-bold text-ink">전체 팀 ({rooms.length}개)</h3>
              <div className="mb-3 flex flex-wrap gap-2">
                <button type="button" className="admin-btn" onClick={() => handleDownloadCsv("tasks")}>업무 CSV</button>
                <button type="button" className="admin-btn" onClick={() => handleDownloadCsv("users")}>사용자 CSV</button>
              </div>
              <ul className="m-0 grid list-none gap-2 p-0">
                {rooms.map((room) => (
                  <li key={room.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-bold text-ink">{room.name} (멤버 {room.memberCount}명)</span>
                      <span className="text-xs text-muted [overflow-wrap:anywhere]">{room.description}</span>
                    </div>
                    <div className="flex flex-shrink-0 flex-wrap justify-end gap-1.5">
                      <button type="button" className="admin-btn" onClick={() => handleSelectRoom(room)}>
                        업무 보기
                      </button>
                      <button type="button" className="admin-btn danger" onClick={() => handleDeleteRoom(room)}>
                        팀 삭제
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {selectedRoom && (
              <section className="mt-5">
                <h3 className="m-0 mb-3 text-[15px] font-bold text-ink">
                  {selectedRoom.name} 업무 ({roomTasks.length}개)
                </h3>
                {roomTasks.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted">등록된 업무가 없습니다.</p>
                ) : (
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {roomTasks.map((task) => (
                      <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-sm font-bold text-ink">{task.title}</span>
                          <span className="text-xs text-muted [overflow-wrap:anywhere]">
                            담당: {task.assignee || "미지정"} · {statusLabels[task.status]} · {priorityLabels[task.priority]} · 마감 {task.dueDate}
                          </span>
                        </div>
                        <button type="button" className="admin-btn danger shrink-0" onClick={() => handleDeleteTask(task)}>
                          삭제
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}

        {activeTab === "stats" && (
          <section className="mt-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="m-0 text-[15px] font-bold text-ink">운영 통계</h3>
              <button type="button" className="admin-btn" onClick={loadStats}>새로고침</button>
            </div>
            {stats ? (
              <div className="grid gap-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {Object.entries(stats.totalsByStatus).map(([status, count]) => (
                    <div key={status} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <p className="m-0 text-xs text-muted">{statusLabels[status as keyof typeof statusLabels] ?? status}</p>
                      <strong className="mt-2 block text-2xl text-ink">{count}</strong>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <h4 className="m-0 mb-3 text-sm font-bold text-ink">팀별 완료율</h4>
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {stats.completionRateByRoom.map((room) => (
                      <li key={room.roomId} className="text-sm">
                        {room.name}: {Math.round(room.rate * 100)}% ({room.completed}/{room.total})
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <h4 className="m-0 mb-3 text-sm font-bold text-ink">사용자별 처리량</h4>
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {stats.completionRateByUser.map((user) => (
                      <li key={user.name} className="text-sm">
                        {user.name}: 완료 {user.completed} / 전체 {user.total}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <h4 className="m-0 mb-3 text-sm font-bold text-ink">지연 업무</h4>
                  {stats.overdueTasks.length === 0 ? (
                    <p className="text-sm text-muted">지연 업무가 없습니다.</p>
                  ) : (
                    <ul className="m-0 grid list-none gap-2 p-0">
                      {stats.overdueTasks.map((task) => (
                        <li key={task.id} className="text-sm">
                          {task.roomName} · {task.title} · {task.dueDate} · {task.assignee || "미지정"}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-muted">통계를 불러오는 중입니다.</p>
            )}
          </section>
        )}
        {activeTab === "audit" && (
          <section className="mt-5">
            <form className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4" onSubmit={handleAuditFilterSubmit}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <select
                  className="control"
                  value={auditFilters.action}
                  onChange={(event) => setAuditFilters({ ...auditFilters, action: event.target.value })}
                  aria-label="액션 필터"
                >
                  <option value="">전체 액션</option>
                  {actionOptions.map((action) => (
                    <option key={action} value={action}>{action}</option>
                  ))}
                </select>
                <select
                  className="control"
                  value={auditFilters.actorId}
                  onChange={(event) => setAuditFilters({ ...auditFilters, actorId: event.target.value })}
                  aria-label="사용자 필터"
                >
                  <option value="">전체 사용자</option>
                  {users.map((user) => (
                    <option key={user.id} value={String(user.id)}>{user.name}</option>
                  ))}
                </select>
                <input
                  className="control"
                  type="datetime-local"
                  value={auditFilters.since}
                  onChange={(event) => setAuditFilters({ ...auditFilters, since: event.target.value })}
                  aria-label="시작일 필터"
                />
              </div>
              <button type="submit" className="btn primary" disabled={auditLoading}>
                {auditLoading ? "조회 중..." : "감사 로그 조회"}
              </button>
            </form>

            {auditError && <div className="message error mb-4">{auditError}</div>}
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="m-0 text-[15px] font-bold text-ink">감사 로그 ({auditTotal}건)</h3>
              <div className="flex gap-2">
                <button type="button" className="admin-btn" onClick={() => loadAudit(Math.max(0, auditOffset - auditLimit))} disabled={auditOffset === 0 || auditLoading}>
                  이전
                </button>
                <button type="button" className="admin-btn" onClick={() => loadAudit(auditOffset + auditLimit)} disabled={auditOffset + auditLimit >= auditTotal || auditLoading}>
                  다음
                </button>
              </div>
            </div>

            {auditEvents.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">감사 로그가 없습니다.</p>
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0">
                {auditEvents.map((event) => (
                  <li key={event.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-ink">{event.action}</div>
                        <div className="mt-1 text-xs text-muted [overflow-wrap:anywhere]">
                          {formatDateTime(event.createdAt)} · 행위자 {event.actorName || "익명"} {event.actorRole && `(${event.actorRole})`} · 대상 {event.targetType || "-"}/{event.targetId || "-"} · IP {event.ip || "-"}
                        </div>
                      </div>
                      <button type="button" className="admin-btn shrink-0" onClick={() => toggleAuditDetail(event.id)}>
                        {expandedAuditIds.has(event.id) ? "접기" : "상세"}
                      </button>
                    </div>
                    {expandedAuditIds.has(event.id) && (
                      <pre className="mt-3 overflow-x-auto rounded-md bg-white p-3 text-xs text-slate-700">
                        {formatDetail(event.detail)}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
