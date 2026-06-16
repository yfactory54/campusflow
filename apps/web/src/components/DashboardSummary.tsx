import type { Task } from "../types/task";
import { isDueSoon, isOverdue } from "../utils/dateUtils";

interface DashboardSummaryProps {
  tasks: Task[];
}

interface SummaryItem {
  label: string;
  value: number | string;
  tone: string;
}

export default function DashboardSummary({ tasks }: DashboardSummaryProps) {
  const totalCount = tasks.length;
  const urgentCount = tasks.filter(
    (task) => task.status !== "done" && isDueSoon(task.dueDate),
  ).length;
  const overdueCount = tasks.filter(
    (task) => task.status !== "done" && isOverdue(task.dueDate),
  ).length;
  const activeCount = tasks.filter(
    (task) => task.status === "inProgress",
  ).length;
  const completedCount = tasks.filter((task) => task.status === "done").length;
  const doneRate =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const items: SummaryItem[] = [
    { label: "전체 업무", value: totalCount, tone: "text-ink" },
    { label: "완료 업무", value: completedCount, tone: "text-brand" },
    { label: "진행 중", value: activeCount, tone: "text-info" },
    { label: "마감 임박", value: urgentCount, tone: "text-warn" },
    { label: "기한 초과", value: overdueCount, tone: "text-danger" },
  ];

  return (
    <>
      <div className="mb-6 rounded-xl border border-line bg-white p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <h3 className="m-0 text-sm text-ink">전체 업무 완료율</h3>
            <p className="mt-0.5 text-xs text-muted">완료된 업무의 실시간 진행 상황입니다.</p>
          </div>
          <div className="flex items-baseline gap-1 text-brand">
            <span className="text-[32px] font-extrabold">
              {doneRate}
            </span>
            <span className="text-sm font-extrabold opacity-75">%</span>
          </div>
        </div>

        <div className="h-3 overflow-hidden rounded-full bg-canvas">
          <div
            className="h-full rounded-full bg-brand"
            style={{ width: `${doneRate}%` }}
          ></div>
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-3 text-xs font-bold text-muted">
          <span>대기/진행 중: {activeCount + urgentCount + overdueCount}개</span>
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            완료: {completedCount} / {totalCount}개
          </span>
        </div>
      </div>

      <section
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        aria-label="업무 요약"
      >
        {items.map((item) => (
          <div
            key={item.label}
            className="min-w-0 rounded-lg border border-line bg-white px-4 py-3 sm:px-5 sm:py-4"
          >
            <p className="m-0 text-sm text-muted">{item.label}</p>
            <strong className={`mt-2 block text-2xl font-extrabold sm:text-[32px] ${item.tone}`}>
              {item.value}
            </strong>
          </div>
        ))}
      </section>
    </>
  );
}
