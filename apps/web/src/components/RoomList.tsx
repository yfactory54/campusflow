import { useState, useEffect } from "react";
import useFetch from "../fetch/useFetch";

interface Team {
    id: number;
    name: string;
    memberCount: number;
    description: string;
    createdBy: number | null;
}

interface RoomListProps {
    onSelectRoom: (room: Team) => void;
    canCreateRoom: boolean;
}

interface RoomsResponse {
    rooms: Team[];
}

interface CreateRoomResponse {
    room: Team;
}

export default function RoomList({ onSelectRoom, canCreateRoom }: RoomListProps) {
    const [teams, setTeams] = useState<Team[]>([]);
    const { request: fetchRooms, loading: listLoading, error: listError } = useFetch<RoomsResponse>();
    const { request: createRoom, loading: addLoading, error: addError } = useFetch<CreateRoomResponse>();

    const [isAdding, setIsAdding] = useState(false);
    const [newTeamName, setNewTeamName] = useState("");
    const [newTeamDesc, setNewTeamDesc] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        const loadRooms = async () => {
            const result = await fetchRooms("rooms");
            if (result.ok && result.data?.rooms) {
                setTeams(result.data.rooms);
            }
        };
        loadRooms();
    }, [fetchRooms]);

    const handleAddTeam = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTeamName.trim()) {
            setError("팀 이름을 입력해 주세요.");
            return;
        }

        const result = await createRoom("rooms", {
            method: "POST",
            body: {
                name: newTeamName.trim(),
                description: newTeamDesc.trim() || "새로 생성된 프로젝트 협업 팀입니다.",
            },
        });

        if (!result.ok || !result.data?.room) {
            return;
        }

        setTeams([...teams, result.data.room]);
        setNewTeamName("");
        setNewTeamDesc("");
        setIsAdding(false);
        setError("");
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
            <div className="w-full max-w-[480px] rounded-xl border border-gray-200 bg-white p-6 sm:p-8">
                {listLoading && (
                    <div className="message info mb-4">
                        팀 목록을 불러오는 중...
                    </div>
                )}
                {listError && (
                    <div className="message error mb-4">
                        {listError}
                    </div>
                )}
                <div className="mb-6 flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
                    <div>
                        <h1 className="m-0 font-display text-[22px] font-extrabold text-gray-800">
                            참여 중인 팀 목록
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            {canCreateRoom
                                ? "협업을 진행할 팀을 선택하거나 새 팀을 만드세요."
                                : "협업을 진행할 팀을 선택하세요."}
                        </p>
                    </div>
                    {canCreateRoom && (
                        <button
                            type="button"
                            onClick={() => setIsAdding(!isAdding)}
                            className={`btn toggle shrink-0 ${isAdding ? "secondary" : "primary"}`}
                        >
                            {isAdding ? "닫기" : "팀 등록"}
                        </button>
                    )}
                </div>

                {isAdding && (
                    <form
                        onSubmit={handleAddTeam}
                        className="mb-6 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
                    >
                        <div className="grid gap-2">
                            <label className="text-xs font-bold text-slate-600">
                                팀 이름 *
                            </label>
                            <input
                                type="text"
                                placeholder="팀 이름을 입력하세요 (예: 팀3)"
                                value={newTeamName}
                                onChange={(e) => {
                                    setNewTeamName(e.target.value);
                                    if (error) setError("");
                                }}
                                className="control"
                                required
                            />
                            {error && <p className="error small">{error}</p>}
                        </div>

                        <div className="grid gap-2">
                            <label className="text-xs font-bold text-slate-600">
                                설명 (선택)
                            </label>
                            <input
                                type="text"
                                placeholder="팀에 대한 간단한 설명을 적어주세요."
                                value={newTeamDesc}
                                onChange={(e) => setNewTeamDesc(e.target.value)}
                                className="control"
                            />
                        </div>

                        {addError && (
                            <p className="message error">
                                {addError}
                            </p>
                        )}

                        <button
                            type="submit"
                            className="btn primary w-full"
                            disabled={addLoading}
                        >
                            {addLoading ? "팀 등록 중..." : "팀 등록 완료"}
                        </button>
                    </form>
                )}

                <div className="grid max-h-[360px] gap-3 overflow-y-auto pr-1">
                    {teams.map((team) => (
                        <button
                            type="button"
                            key={team.id}
                            onClick={() => onSelectRoom(team)}
                            className="flex w-full items-center justify-between gap-4 rounded-xl border border-slate-100 bg-white p-4 text-left hover:border-brand-hover hover:bg-[#e2f1ea]"
                        >
                            <div className="grid min-w-0 gap-1">
                                <div className="flex items-center gap-2">
                                    <h2 className="m-0 text-base text-gray-800">
                                        {team.name}
                                    </h2>
                                    <span className="rounded-full bg-slate-100 px-1.5 py-[3px] text-[11px] text-slate-600">
                                        멤버 {team.memberCount}명
                                    </span>
                                </div>
                                <p className="m-0 max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-slate-500">
                                    {team.description}
                                </p>
                            </div>
                            <div className="flex items-center text-slate-400">
                                <img className="h-4 w-4" src="/arrow.svg" />
                            </div>
                        </button>
                    ))}

                    {teams.length === 0 && (
                        <div className="py-10 text-center text-slate-500">
                            참여 중인 팀이 없습니다. 새 팀을 만들어 보세요!
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
