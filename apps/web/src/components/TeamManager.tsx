import { useState, useEffect } from "react";
import useFetch from "../fetch/useFetch";
import type { Task } from "../types/task";

interface User {
    id: number;
    name: string;
    email: string;
}

interface TeamManagerProps {
    roomId: number;
    tasks: Task[];
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
    summary: string;
}

interface ContributionResponse {
    contribution: Contribution;
}

export default function TeamManager({ roomId, tasks, onClose }: TeamManagerProps) {
    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [members, setMembers] = useState<User[]>([]);
    const [contribution, setContribution] = useState<Contribution | null>(null);

    const { request: fetchUsers } = useFetch<UsersResponse>();
    const { request: fetchMembers, loading: membersLoading } = useFetch<MembersResponse>();
    const { request: addMember } = useFetch<AddMemberResponse>();
    const { request: removeMember } = useFetch();
    const {
        request: analyzeContribution,
        loading: analyzing,
        error: analyzeError,
    } = useFetch<ContributionResponse>();

    useEffect(() => {
        const load = async () => {
            const [usersData, membersData] = await Promise.all([
                fetchUsers("users"),
                fetchMembers(`rooms/${roomId}/members`),
            ]);
            if (usersData?.users) setAllUsers(usersData.users);
            if (membersData?.members) setMembers(membersData.members);
        };
        load();
    }, [roomId, fetchUsers, fetchMembers]);

    const memberIds = new Set(members.map((m) => m.id));
    const availableUsers = allUsers.filter((u) => !memberIds.has(u.id));

    const handleAdd = async (userId: number) => {
        const data = await addMember(`rooms/${roomId}/members`, {
            method: "POST",
            body: { userId },
        });
        if (data?.member) {
            setMembers([...members, data.member]);
        }
    };

    const handleRemove = async (userId: number) => {
        await removeMember(`rooms/${roomId}/members/${userId}`, {
            method: "DELETE",
        });
        setMembers(members.filter((m) => m.id !== userId));
    };

    const handleAnalyze = async () => {
        const data = await analyzeContribution(`rooms/${roomId}/contribution`, {
            method: "POST",
            body: { tasks },
        });
        if (data?.contribution) {
            setContribution(data.contribution);
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
                                        <span className="text-xs text-muted [overflow-wrap:anywhere]">{member.email}</span>
                                    </div>
                                    <button
                                        type="button"
                                        className="shrink-0 rounded-md border border-danger bg-white px-3.5 py-1.5 text-[13px] font-bold text-danger hover:bg-[#fde8e6]"
                                        onClick={() => handleRemove(member.id)}
                                    >
                                        제거
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {availableUsers.length > 0 && (
                    <div className="mt-5">
                        <h3 className="m-0 mb-3 text-[15px] font-bold text-ink">추가 가능한 회원</h3>
                        <ul className="m-0 grid list-none gap-2 p-0">
                            {availableUsers.map((user) => (
                                <li key={user.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5">
                                    <div className="flex min-w-0 flex-col gap-0.5">
                                        <span className="text-sm font-bold text-ink">{user.name}</span>
                                        <span className="text-xs text-muted [overflow-wrap:anywhere]">{user.email}</span>
                                    </div>
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
                    </div>
                )}
            </div>
        </div>
    );
}
