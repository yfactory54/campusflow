import type { AuthUser } from "../types/user";

interface HeaderProps {
  totalCount: number;
  completedCount: number;
  currentRoomName?: string;
  currentUser: AuthUser | null;
  onBackToRoomList?: () => void;
  onOpenTeamManager?: () => void;
  onOpenAdmin?: () => void;
  onLogout?: () => void;
}

export default function Header({
  totalCount,
  completedCount,
  currentRoomName,
  currentUser,
  onBackToRoomList,
  onOpenTeamManager,
  onOpenAdmin,
  onLogout,
}: HeaderProps) {
  return (
    <>
      <header className="app-header">
        <div className="inner">
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <button
              type="button"
              onClick={onBackToRoomList}
              className="btn primary toggle"
            >
              목록
            </button>

            <h1 className="title">
              {currentRoomName ? `${currentRoomName} 프로젝트` : "프로젝트"} 진행 흐름판
            </h1>
          </div>

          <div className="stats">
            <div className="card">
              <p className="label">전체 업무</p>
              <strong className="value">{totalCount}</strong>
            </div>
            <div className="card">
              <p className="label">완료</p>
              <strong className="value">{completedCount}</strong>
            </div>

            {currentUser && (
              <div className="card">
                <p className="label">{currentUser.role === "admin" ? "관리자" : "사용자"}</p>
                <strong className="value" style={{ fontSize: "1rem" }}>{currentUser.name}</strong>
              </div>
            )}

            {currentUser?.role === "admin" && (
              <button
                type="button"
                onClick={onOpenAdmin}
                className="btn secondary toggle"
              >
                관리자
              </button>
            )}

            <button
              type="button"
              onClick={onOpenTeamManager}
              className="btn primary toggle person"
            />

            <button
              type="button"
              onClick={onLogout}
              className="btn secondary toggle"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>
    </>
  );
}
