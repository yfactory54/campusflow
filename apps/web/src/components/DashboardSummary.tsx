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
    { label: "전체 업무", value: totalCount, tone: "tone-default" },
    { label: "완료 업무", value: completedCount, tone: "tone-success" },
    { label: "진행 중", value: activeCount, tone: "tone-info" },
    { label: "마감 임박", value: urgentCount, tone: "tone-warning" },
    { label: "기한 초과", value: overdueCount, tone: "tone-danger" },
  ];

  return (
    <>
      <div className="summary-progress">
        <div className="header">
          <div>
            <h3 className="title">전체 업무 완료율</h3>
            <p className="note">완료된 업무의 실시간 진행 상황입니다.</p>
          </div>
          <div className="number-wrap">
            <span className="number">
              {doneRate}
            </span>
            <span className="percent">%</span>
          </div>
        </div>

        <div className="track">
          <div
            className="bar"
            style={{ width: `${doneRate}%` }}
          ></div>
        </div>

        <div className="footer">
          <span>대기/진행 중: {activeCount + urgentCount + overdueCount}개</span>
          <span className="complete">
            <span className="dot" />
            완료: {completedCount} / {totalCount}개
          </span>
        </div>
      </div>

      <section
        className="summary-grid"
        aria-label="업무 요약"
      >
        {items.map((item) => (
          <div
            key={item.label}
            className="card"
          >
            <p className="label">{item.label}</p>
            <strong className={`value ${item.tone}`}>
              {item.value}
            </strong>
          </div>
        ))}
      </section>
    </>
  );
}
