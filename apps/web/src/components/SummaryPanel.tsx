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
    { label: "3일 내 마감", value: urgentCount, tone: "text-danger" },
    { label: "기한 초과", value: overdueCount, tone: "text-danger" },
    { label: "진행 중", value: activeCount, tone: "text-info" },
    { label: "완료율", value: `${doneRate}%`, tone: "text-brand" },
  ];

  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="업무 요약">
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
