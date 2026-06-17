import type React from "react";
import type { Task, TaskAction } from "../types/task";
import TaskItem from "./TaskItem";
import type { AuthUser } from "../types/user";

interface TaskListProps {
  tasks: Task[];
  totalCount: number;
  dispatch: React.Dispatch<TaskAction>;
  currentRoomId: number | null;
  currentUser: AuthUser;
}

export default function TaskList({
  tasks,
  totalCount,
  dispatch,
  currentRoomId,
  currentUser,
}: TaskListProps) {
  if (tasks.length === 0) {
    const isFilteredEmpty = totalCount > 0;

    return (
      <>
        <section className="rounded-lg border border-dashed border-line bg-white px-5 py-12 text-center">
          <h3 className="font-display text-2xl font-bold text-ink sm:text-[26px]">
            {isFilteredEmpty
              ? "조건에 맞는 업무가 없습니다"
              : "등록된 업무가 없습니다"}
          </h3>
          <p className="mt-2 text-sm text-muted">
            {isFilteredEmpty
              ? "검색어 또는 필터 조건을 조정해 보세요."
              : "새 업무를 등록하면 이 영역에 표시됩니다."}
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      <section className="grid gap-4" aria-label="업무 목록">
        {tasks.map((task) => (
          <TaskItem key={task.id} task={task} dispatch={dispatch} currentRoomId={currentRoomId} currentUser={currentUser} />
        ))}
      </section>
    </>
  );
}
