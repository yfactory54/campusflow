import { useEffect, useState } from "react";
import useFetch from "../fetch/useFetch";

interface StatsResponse {
  stats: {
    totalsByStatus: Record<"todo" | "inProgress" | "done", number>;
    completionRateByRoom: Array<{ roomId: number; name: string; completed: number; total: number; rate: number }>;
    completionRateByUser: Array<{ name: string; completed: number; total: number }>;
    overdueTasks: Array<{ id: string; title: string; dueDate: string; assignee: string }>;
    priorityDistribution: Record<"low" | "medium" | "high", number>;
  };
}

interface RoomStatsPanelProps {
  roomId: number;
  roomName: string;
  onClose: () => void;
}

const statusLabels = { todo: "할 일", inProgress: "진행 중", done: "완료" };
const priorityLabels = { low: "낮음", medium: "보통", high: "높음" };

export default function RoomStatsPanel({ roomId, roomName, onClose }: RoomStatsPanelProps) {
  const [stats, setStats] = useState<StatsResponse["stats"] | null>(null);
  const { request: fetchStats, loading, error } = useFetch<StatsResponse>();

  useEffect(() => {
    let active = true;
    const loadStats = async () => {
      const result = await fetchStats(`rooms/${roomId}/stats`);
      if (active && result.ok && result.data?.stats) {
        setStats(result.data.stats);
      }
    };
    void loadStats();
    return () => {
      active = false;
    };
  }, [fetchStats, roomId]);

  const roomRate = stats?.completionRateByRoom[0];

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-[720px] overflow-y-auto rounded-xl bg-white p-5 sm:p-7" onClick={(event) => event.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <p className="m-0 text-sm font-bold text-brand">팀 통계</p>
            <h2 className="m-0 font-display text-xl font-bold text-ink">{roomName}</h2>
          </div>
          <button type="button" className="btn secondary" onClick={onClose}>닫기</button>
        </div>

        {loading && <div className="message info">통계를 불러오는 중...</div>}
        {error && <div className="message error">{error}</div>}

        {stats && (
          <div className="grid gap-4">
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {Object.entries(stats.totalsByStatus).map(([status, count]) => (
                <div key={status} className="rounded-lg border border-line bg-gray-50 p-4">
                  <p className="m-0 text-sm text-muted">{statusLabels[status as keyof typeof statusLabels]}</p>
                  <strong className="mt-2 block text-2xl text-ink">{count}</strong>
                </div>
              ))}
            </section>

            <section className="rounded-lg border border-line p-4">
              <h3 className="m-0 mb-2 text-base font-bold text-ink">완료율</h3>
              <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full bg-brand" style={{ width: `${Math.round((roomRate?.rate ?? 0) * 100)}%` }} />
              </div>
              <p className="mt-2 text-sm text-muted">
                {Math.round((roomRate?.rate ?? 0) * 100)}% 완료 ({roomRate?.completed ?? 0}/{roomRate?.total ?? 0})
              </p>
            </section>

            <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-line p-4">
                <h3 className="m-0 mb-3 text-base font-bold text-ink">담당자별 처리량</h3>
                {stats.completionRateByUser.length === 0 ? (
                  <p className="text-sm text-muted">업무가 없습니다.</p>
                ) : (
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {stats.completionRateByUser.map((user) => (
                      <li key={user.name} className="flex justify-between gap-2 text-sm">
                        <span>{user.name}</span>
                        <strong>{user.completed}/{user.total}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-lg border border-line p-4">
                <h3 className="m-0 mb-3 text-base font-bold text-ink">우선순위 분포</h3>
                <ul className="m-0 grid list-none gap-2 p-0">
                  {Object.entries(stats.priorityDistribution).map(([priority, count]) => (
                    <li key={priority} className="flex justify-between gap-2 text-sm">
                      <span>{priorityLabels[priority as keyof typeof priorityLabels]}</span>
                      <strong>{count}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="rounded-lg border border-line p-4">
              <h3 className="m-0 mb-3 text-base font-bold text-ink">지연 업무</h3>
              {stats.overdueTasks.length === 0 ? (
                <p className="text-sm text-muted">지연 업무가 없습니다.</p>
              ) : (
                <ul className="m-0 grid list-none gap-2 p-0">
                  {stats.overdueTasks.map((task) => (
                    <li key={task.id} className="text-sm">
                      {task.title} · {task.dueDate} · {task.assignee || "미지정"}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
