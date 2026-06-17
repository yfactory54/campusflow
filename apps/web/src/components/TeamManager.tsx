import { useState, useEffect } from "react";
import useFetch from "../fetch/useFetch";

import type { AuthUser } from "../types/user";

interface User {
    id: number;
    name: string;
    email?: string;
}

interface TeamManagerProps {
    roomId: number;
    room: { createdBy: number | null };
    currentUser: AuthUser;

    onClose: () => void;
}

interface UsersResponse {
    users: User[];
}

interface MembersResponse {
    members: User[];
}

interface AddMemberResponse {
    member: User;
}

interface ContributionMember {
    name: string;
    score: number;
    assignedCount: number;
    completedCount: number;
    summary: string;
}

interface Contribution {
    members: ContributionMember[];
    source?: "llm" | "fallback";
    summary: string;
}

interface ContributionResponse {
    contribution: Contribution;
}

export default function TeamManager({ roomId, room, currentUser, onClose }: TeamManagerProps) {
    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [members, setMembers] = useState<User[]>([]);
    const [contribution, setContribution] = useState<Contribution | null>(null);
    const [userSearch, setUserSearch] = useState("");

    const { request: fetchUsers, loading: usersLoading, error: usersError } = useFetch<UsersResponse>();
    const { request: fetchMembers, loading: membersLoading } = useFetch<MembersResponse>();
    const { request: addMember, error: addError } = useFetch<AddMemberResponse>();
    const { request: removeMember, error: removeError } = useFetch();
    const {
        request: analyzeContribution,
        loading: analyzing,
        error: analyzeError,
    } = useFetch<ContributionResponse>();

    const canManage =
        currentUser.role === "admin" ||
        currentUser.role === "leader" ||
        String(room.createdBy) === String(currentUser.id);
    const canSearchUsers = currentUser.role === "admin" || currentUser.role === "leader";

    useEffect(() => {
        const loadMembers = async () => {
            const result = await fetchMembers(`rooms/${roomId}/members`);
            if (result.ok && result.data?.members) setMembers(result.data.members);
        };
        loadMembers();
    }, [roomId, fetchMembers]);

    useEffect(() => {
        const query = userSearch.trim();
        if (!canSearchUsers || !query) {
            return;
        }

        const loadUsers = async () => {
            const result = await fetchUsers(`users/search?q=${encodeURIComponent(query)}`);
            if (result.ok && result.data?.users) setAllUsers(result.data.users);
        };
        loadUsers();
    }, [canSearchUsers, fetchUsers, userSearch]);

    const memberIds = new Set(members.map((m) => m.id));
    const availableUsers = canSearchUsers && userSearch.trim() ? allUsers.filter((u) => !memberIds.has(u.id)) : [];

    const handleAdd = async (userId: number) => {
        if (!canManage) return;
        const result = await addMember(`rooms/${roomId}/members`, {
            method: "POST",
            body: { userId },
        });
        if (result.ok && result.data?.member) {
            setMembers([...members, result.data.member]);
            setUserSearch("");
            setAllUsers([]);
        }
    };

    const handleRemove = async (userId: number) => {
        if (!canManage) return;
        const result = await removeMember(`rooms/${roomId}/members/${userId}`, {
            method: "DELETE",
        });
        if (result.ok) setMembers(members.filter((m) => m.id !== userId));
    };

    const handleAnalyze = async () => {
        const result = await analyzeContribution(`rooms/${roomId}/contribution`, {
            method: "POST",
        });
        if (result.ok && result.data?.contribution) {
            setContribution(result.data.contribution);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
            <div className="max-h-[85vh] w-full max-w-[520px] overflow-y-auto rounded-xl bg-white p-5 sm:p-7" onClick={(e) => e.stopPropagation()}>
                <div className="mb-5 flex items-center justify-between gap-4">
                    <h2 className="m-0 font-display text-xl font-bold text-ink">팀원 관리</h2>
                    <button type="button" className="btn secondary" onClick={onClose}>
                        닫기
                    </button>
                </div>

                {membersLoading && (
                    <div className="message info">팀원 정보를 불러오는 중...</div>
                )}

                {(addError || removeError) && (
                    <div className="message error mt-3">{addError || removeError}</div>
                )}

                <div className="mt-5">
                    <div className="flex items-center justify-between gap-3">
                        <h3 className="m-0 text-[15px] font-bold text-ink">AI 기여도 분석</h3>
                        <button
                            type="button"
                            className="btn primary"
                            onClick={handleAnalyze}
                            disabled={analyzing}
                        >
                            {analyzing ? "분석 중..." : "기여도 분석"}
                        </button>
                    </div>

                    {analyzeError && <div className="message error mt-3">{analyzeError}</div>}

                    {analyzing && (
                        <div className="message info mt-3">
                            업무 목록을 분석하여 멤버별 기여도를 계산하는 중...
                        </div>
                    )}

                    {contribution && !analyzing && (
                        <>
                            <ul className="m-0 mt-4 grid list-none gap-3.5 p-0">
                                {contribution.members.map((member) => (
                                    <li key={member.name} className="rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3">
                                        <div className="mb-2 flex items-baseline justify-between gap-3">
                                            <span className="text-sm font-bold text-ink">{member.name}</span>
                                            <span className="text-base font-extrabold text-brand">{member.score}%</span>
                                        </div>
                                        <div className="h-2.5 overflow-hidden rounded-full bg-canvas">
                                            <div
                                                className="h-full rounded-full bg-brand transition-[width] duration-300"
                                                style={{ width: `${Math.max(0, Math.min(100, member.score))}%` }}
                                            />
                                        </div>
                                        <div className="mt-2 text-xs font-bold text-muted">
                                            담당 {member.assignedCount} · 완료 {member.completedCount}
                                        </div>
                                        {member.summary && (
                                            <p className="mt-1.5 text-[13px] leading-normal text-gray-600">{member.summary}</p>
                                        )}
                                    </li>
                                ))}
                            </ul>
                            {contribution.source === "fallback" && (
                                <span className="mt-3 inline-block rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-muted">
                                    규칙 기반 결과
                                </span>
                            )}
                            {contribution.summary && (
                                <p className="mt-4 rounded-lg bg-[#d8efe3] px-3.5 py-3 text-[13px] leading-relaxed text-ink">{contribution.summary}</p>
                            )}
                        </>
                    )}
                </div>

                <div className="mt-5">
                    <h3 className="m-0 mb-3 text-[15px] font-bold text-ink">현재 팀원 ({members.length}명)</h3>
                    {members.length === 0 ? (
                        <p className="py-4 text-center text-sm text-muted">팀원이 없습니다.</p>
                    ) : (
                        <ul className="m-0 grid list-none gap-2 p-0">
                            {members.map((member) => (
                                <li key={member.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5">
                                    <div className="flex min-w-0 flex-col gap-0.5">
                                        <span className="text-sm font-bold text-ink">{member.name}</span>
                                        {member.email && <span className="text-xs text-muted [overflow-wrap:anywhere]">{member.email}</span>}
                                    </div>
                                    {canManage && (
                                        <button
                                            type="button"
                                            className="shrink-0 rounded-md border border-danger bg-white px-3.5 py-1.5 text-[13px] font-bold text-danger hover:bg-[#fde8e6]"
                                            onClick={() => handleRemove(member.id)}
                                        >
                                            제거
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {canManage && (
                    <div className="mt-5">
                        <h3 className="m-0 mb-3 text-[15px] font-bold text-ink">팀원 추가</h3>
                        {canSearchUsers ? (
                            <>
                                <input
                                    className="control"
                                    placeholder="이름으로 회원 검색"
                                    value={userSearch}
                                    onChange={(event) => setUserSearch(event.target.value)}
                                />
                                {usersLoading && <div className="message info mt-3">회원을 검색하는 중...</div>}
                                {usersError && <div className="message error mt-3">{usersError}</div>}
                                {availableUsers.length > 0 ? (
                                    <ul className="m-0 mt-3 grid list-none gap-2 p-0">
                                        {availableUsers.map((user) => (
                                            <li key={user.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5">
                                                <span className="text-sm font-bold text-ink">{user.name}</span>
                                                <button
                                                    type="button"
                                                    className="shrink-0 rounded-md border border-brand bg-white px-3.5 py-1.5 text-[13px] font-bold text-brand hover:bg-[#d8efe3]"
                                                    onClick={() => handleAdd(user.id)}
                                                >
                                                    추가
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    userSearch.trim() && !usersLoading && <p className="py-3 text-center text-sm text-muted">검색된 회원이 없습니다.</p>
                                )}
                            </>
                        ) : (
                            <p className="text-sm text-muted">회원 검색은 관리자와 팀장만 사용할 수 있습니다.</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
