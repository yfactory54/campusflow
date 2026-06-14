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
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="title">팀원 관리</h2>
                    <button type="button" className="btn secondary" onClick={onClose}>
                        닫기
                    </button>
                </div>

                {membersLoading && (
                    <div className="message info">팀원 정보를 불러오는 중...</div>
                )}

                <div className="modal-section">
                    <div className="contribution-header">
                        <h3 className="modal-subtitle">AI 기여도 분석</h3>
                        <button
                            type="button"
                            className="btn primary"
                            onClick={handleAnalyze}
                            disabled={analyzing}
                        >
                            {analyzing ? "분석 중..." : "기여도 분석"}
                        </button>
                    </div>

                    {analyzeError && <div className="message error">{analyzeError}</div>}

                    {analyzing && (
                        <div className="message info">
                            업무 목록을 분석하여 멤버별 기여도를 계산하는 중...
                        </div>
                    )}

                    {contribution && !analyzing && (
                        <>
                            <ul className="contribution-list">
                                {contribution.members.map((member) => (
                                    <li key={member.name} className="contribution-item">
                                        <div className="contribution-row">
                                            <span className="contribution-name">{member.name}</span>
                                            <span className="contribution-score">{member.score}%</span>
                                        </div>
                                        <div className="contribution-track">
                                            <div
                                                className="contribution-bar"
                                                style={{ width: `${Math.max(0, Math.min(100, member.score))}%` }}
                                            />
                                        </div>
                                        <div className="contribution-meta">
                                            담당 {member.assignedCount} · 완료 {member.completedCount}
                                        </div>
                                        {member.summary && (
                                            <p className="contribution-summary">{member.summary}</p>
                                        )}
                                    </li>
                                ))}
                            </ul>
                            {contribution.summary && (
                                <p className="contribution-overall">{contribution.summary}</p>
                            )}
                        </>
                    )}
                </div>

                <div className="modal-section">
                    <h3 className="modal-subtitle">현재 팀원 ({members.length}명)</h3>
                    {members.length === 0 ? (
                        <p className="modal-empty">팀원이 없습니다.</p>
                    ) : (
                        <ul className="member-list">
                            {members.map((member) => (
                                <li key={member.id} className="member-item">
                                    <div className="member-info">
                                        <span className="member-name">{member.name}</span>
                                        <span className="member-email">{member.email}</span>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn-remove"
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
                    <div className="modal-section">
                        <h3 className="modal-subtitle">추가 가능한 회원</h3>
                        <ul className="member-list">
                            {availableUsers.map((user) => (
                                <li key={user.id} className="member-item">
                                    <div className="member-info">
                                        <span className="member-name">{user.name}</span>
                                        <span className="member-email">{user.email}</span>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn-add"
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
