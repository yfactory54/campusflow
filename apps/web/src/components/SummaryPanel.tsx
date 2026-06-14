import type { Task } from "../types/task";
import { getDaysUntilDue } from "../utils/dateUtils";

interface SummaryPanelProps {
  tasks: Task[];
}

export default function SummaryPanel({ tasks }: SummaryPanelProps) {
  const urgentCount = tasks.filter((task) => {
    const days = getDaysUntilDue(task.dueDate);
    return task.status !== "done" && days >= 0 && days <= 3;
  }).length;
  const overdueCount = tasks.filter(
    (task) => task.status !== "done" && getDaysUntilDue(task.dueDate) < 0,
  ).length;
  const activeCount = tasks.filter(
    (task) => task.status === "inProgress",
  ).length;
  const doneRate =
    tasks.length > 0
      ? Math.round(
          (tasks.filter((task) => task.status === "done").length /
            tasks.length) *
            100,
        )
      : 0;

  const items = [
    { label: "3일 내 마감", value: urgentCount, tone: "tone-danger" },
    { label: "기한 초과", value: overdueCount, tone: "tone-danger" },
    { label: "진행 중", value: activeCount, tone: "tone-info" },
    { label: "완료율", value: `${doneRate}%`, tone: "tone-success" },
  ];

  return (
    <>
      <section className="summary-grid compact" aria-label="업무 요약">
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
