import { useState, useEffect } from "react";
import useFetch from "../fetch/useFetch";

interface Team {
    id: number;
    name: string;
    memberCount: number;
    description: string;
}

interface RoomListProps {
    onSelectRoom: (roomId: number, roomName: string) => void;
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
            const data = await fetchRooms("rooms");
            if (data && data.rooms) {
                setTeams(data.rooms);
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

        const data = await createRoom("rooms", {
            method: "POST",
            body: {
                name: newTeamName.trim(),
                description: newTeamDesc.trim() || "새로 생성된 프로젝트 협업 팀입니다.",
            },
        });

        if (!data || !data.room) {
            return;
        }

        setTeams([...teams, data.room]);
        setNewTeamName("");
        setNewTeamDesc("");
        setIsAdding(false);
        setError("");
    };

    return (
        <div className="room-page">
            <div className="card">
                {listLoading && (
                    <div className="message info">
                        팀 목록을 불러오는 중...
                    </div>
                )}
                {listError && (
                    <div className="message error">
                        {listError}
                    </div>
                )}
                <div className="header">
                    <div>
                        <h1 className="title">
                            참여 중인 팀 목록
                        </h1>
                        <p className="subtitle">
                            {canCreateRoom
                                ? "협업을 진행할 팀을 선택하거나 새 팀을 만드세요."
                                : "협업을 진행할 팀을 선택하세요."}
                        </p>
                    </div>
                    {canCreateRoom && (
                        <button
                            type="button"
                            onClick={() => setIsAdding(!isAdding)}
                            className={`btn toggle ${isAdding ? "secondary" : "primary"}`}
                        >
                            {isAdding ? "닫기" : "팀 등록"}
                        </button>
                    )}
                </div>

                {isAdding && (
                    <form
                        onSubmit={handleAddTeam}
                        className="form"
                    >
                        <div className="field-block">
                            <label className="field">
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

                        <div className="field-block">
                            <label className="field">
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
                            className="btn primary full"
                            disabled={addLoading}
                        >
                            {addLoading ? "팀 등록 중..." : "팀 등록 완료"}
                        </button>
                    </form>
                )}

                <div className="list">
                    {teams.map((team) => (
                        <button
                            type="button"
                            key={team.id}
                            onClick={() => onSelectRoom(team.id, team.name)}
                            className="room-btn"
                        >
                            <div className="info">
                                <div className="title-row">
                                    <h2 className="name">
                                        {team.name}
                                    </h2>
                                    <span className="badge">
                                        멤버 {team.memberCount}명
                                    </span>
                                </div>
                                <p className="desc">
                                    {team.description}
                                </p>
                            </div>
                            <div className="arrow">
                                <img className="icon" src="/arrow.svg" />
                            </div>
                        </button>
                    ))}

                    {teams.length === 0 && (
                        <div className="empty">
                            참여 중인 팀이 없습니다. 새 팀을 만들어 보세요!
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
