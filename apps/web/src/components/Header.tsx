import type { AuthUser } from "../types/user";
import NotificationBell from "./NotificationBell";

interface HeaderProps {
  totalCount: number;
  completedCount: number;
  currentRoomName?: string;
  currentUser: AuthUser | null;
  onBackToRoomList?: () => void;
  onOpenTeamManager?: () => void;
  onOpenRoomStats?: () => void;
  onOpenAdmin?: () => void;
  onLogout?: () => void;
  onLogoutAll?: () => void;
}

export default function Header({
  totalCount,
  completedCount,
  currentRoomName,
  currentUser,
  onBackToRoomList,
  onOpenTeamManager,
  onOpenRoomStats,
  onOpenAdmin,
  onLogout,
  onLogoutAll,
}: HeaderProps) {
  return (
    <header className="border-b border-line bg-canvas">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-5 sm:py-7 lg:flex-row lg:items-end lg:justify-between lg:gap-5">
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            type="button"
            onClick={onBackToRoomList}
            className="btn primary toggle shrink-0"
          >
            목록
          </button>

          <h1 className="m-0 font-display text-2xl font-bold text-ink sm:text-3xl lg:text-[2.5rem]">
            {currentRoomName ? `${currentRoomName} 프로젝트` : "프로젝트"} 진행 흐름판
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[96px] rounded-lg border border-line bg-white px-4 py-3 sm:min-w-[120px] sm:px-5 sm:py-4">
            <p className="m-0 text-sm text-muted">전체 업무</p>
            <strong className="mt-2 block text-2xl font-extrabold sm:text-[32px]">{totalCount}</strong>
          </div>
          <div className="min-w-[96px] rounded-lg border border-line bg-white px-4 py-3 sm:min-w-[120px] sm:px-5 sm:py-4">
            <p className="m-0 text-sm text-muted">완료</p>
            <strong className="mt-2 block text-2xl font-extrabold sm:text-[32px]">{completedCount}</strong>
          </div>

          {currentUser && (
            <div className="min-w-[96px] rounded-lg border border-line bg-white px-4 py-3 sm:min-w-[120px] sm:px-5 sm:py-4">
              <p className="m-0 text-sm text-muted">{currentUser.role === "admin" ? "관리자" : "사용자"}</p>
              <strong className="mt-2 block text-base font-extrabold">{currentUser.name}</strong>
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
          {currentRoomName && (
            <button
              type="button"
              onClick={onOpenRoomStats}
              className="btn secondary toggle"
            >
              팀 통계
            </button>
          )}

          <button
            type="button"
            onClick={onOpenTeamManager}
            aria-label="팀원 관리"
            className="h-14 w-14 shrink-0 rounded-md bg-brand bg-[url(/person.svg)] bg-[length:28px] bg-center bg-no-repeat hover:bg-brand-dark sm:h-[70px] sm:w-[70px] sm:bg-[length:30px]"
          />

          <NotificationBell />
          <button
            type="button"
            onClick={onLogoutAll}
            className="btn secondary toggle"
          >
            모든 기기 로그아웃
          </button>
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
  );
}
