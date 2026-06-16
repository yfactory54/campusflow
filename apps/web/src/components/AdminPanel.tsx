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
}

interface AdminPanelProps {
  currentUser: AuthUser;
  onClose: () => void;
}

const emptyNewUser = { name: "", email: "", password: "", role: "member" as UserRole };

const roleLabels: Record<UserRole, string> = { admin: "관리자", leader: "팀장", member: "회원" };

export default function AdminPanel({ currentUser, onClose }: AdminPanelProps) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [roomTasks, setRoomTasks] = useState<Task[]>([]);
  const [newUser, setNewUser] = useState(emptyNewUser);
  const [formError, setFormError] = useState("");

  const { request: fetchUsers } = useFetch<{ users: ManagedUser[] }>();
  const { request: fetchRooms } = useFetch<{ rooms: Room[] }>();
  const { request: fetchTasks } = useFetch<{ tasks: Task[] }>();
  const { request: createUser, loading: creating, error: createError } = useFetch<{ user: ManagedUser }>();
  const { request: patchUser } = useFetch<{ user: ManagedUser }>();
  const { request: mutate } = useFetch();

  const loadUsers = async () => {
    const data = await fetchUsers("admin/users");
    if (data?.users) setUsers(data.users);
  };

  const loadRooms = async () => {
    const data = await fetchRooms("rooms");
    if (data?.rooms) setRooms(data.rooms);
  };

  useEffect(() => {
    const load = async () => {
      const [usersData, roomsData] = await Promise.all([
        fetchUsers("admin/users"),
        fetchRooms("rooms"),
      ]);
      if (usersData?.users) setUsers(usersData.users);
      if (roomsData?.rooms) setRooms(roomsData.rooms);
    };
    load();
  }, [fetchUsers, fetchRooms]);

  const handleSelectRoom = async (room: Room) => {
    setSelectedRoom(room);
    const data = await fetchTasks(`rooms/${room.id}/tasks`);
    setRoomTasks(data?.tasks ?? []);
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
    const data = await createUser("admin/users", {
      method: "POST",
      body: {
        name: newUser.name.trim(),
        email: newUser.email.trim(),
        password: newUser.password,
        role: newUser.role,
      },
    });
    if (data?.user) {
      setNewUser(emptyNewUser);
      loadUsers();
    }
  };

  const handleSetRole = async (user: ManagedUser, role: UserRole) => {
    if (role === user.role) return;
    const data = await patchUser(`admin/users/${user.id}/role`, {
      method: "PATCH",
      body: { role },
    });
    if (data?.user) loadUsers();
  };

  const handleToggleActive = async (user: ManagedUser) => {
    const data = await patchUser(`admin/users/${user.id}/active`, {
      method: "PATCH",
      body: { isActive: !user.isActive },
    });
    if (data?.user) loadUsers();
  };

  const handleResetPassword = async (user: ManagedUser) => {
    const password = window.prompt(`${user.name}님의 새 비밀번호 (8자 이상)`);
    if (!password) return;
    if (password.length < 8) {
      alert("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    await mutate(`admin/users/${user.id}/reset-password`, {
      method: "POST",
      body: { password },
    });
    alert("비밀번호가 변경되었습니다.");
  };

  const handleDeleteRoom = async (room: Room) => {
    if (!confirm(`'${room.name}' 팀을 삭제하시겠습니까? 소속 업무도 함께 삭제됩니다.`)) return;
    await mutate(`rooms/${room.id}`, { method: "DELETE" });
    if (selectedRoom?.id === room.id) {
      setSelectedRoom(null);
      setRoomTasks([]);
    }
    loadRooms();
  };

  const handleDeleteTask = async (task: Task) => {
    if (!selectedRoom) return;
    if (!confirm(`'${task.title}' 업무를 삭제하시겠습니까?`)) return;
    await mutate(`rooms/${selectedRoom.id}/tasks/${task.id}`, { method: "DELETE" });
    setRoomTasks((tasks) => tasks.filter((item) => item.id !== task.id));
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
      <div className="w-full max-w-[640px] rounded-xl border border-gray-200 bg-white p-6 sm:p-8">
        <div className="mb-6 flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h1 className="m-0 font-display text-[22px] font-extrabold text-gray-800">관리자 패널</h1>
            <p className="mt-1 text-xs text-slate-500">사용자 계정과 전체 팀·업무를 관리합니다.</p>
          </div>
          <button type="button" className="btn secondary shrink-0" onClick={onClose}>
            닫기
          </button>
        </div>

        {/* 사용자 관리 */}
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
                placeholder="비밀번호 (8자 이상)"
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
            {(formError || createError) && (
              <p className="message error">{formError || createError}</p>
            )}
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

        {/* 전체 팀·업무 관리 */}
        <section className="mt-5">
          <h3 className="m-0 mb-3 text-[15px] font-bold text-ink">전체 팀 ({rooms.length}개)</h3>
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
      </div>
    </div>
  );
}
