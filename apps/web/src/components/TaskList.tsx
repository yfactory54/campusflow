import type React from "react";
import type { Task, TaskAction } from "../types/task";
import TaskItem from "./TaskItem";

interface TaskListProps {
  tasks: Task[];
  totalCount: number;
  dispatch: React.Dispatch<TaskAction>;
  currentRoomId: number | null;
}

export default function TaskList({
  tasks,
  totalCount,
  dispatch,
  currentRoomId,
}: TaskListProps) {
  if (tasks.length === 0) {
    const isFilteredEmpty = totalCount > 0;

    return (
      <>
        <section className="empty-state">
          <h3 className="title">
            {isFilteredEmpty
              ? "조건에 맞는 업무가 없습니다"
              : "등록된 업무가 없습니다"}
          </h3>
          <p className="description">
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
      <section className="task-list" aria-label="업무 목록">
        {tasks.map((task) => (
          <TaskItem key={task.id} task={task} dispatch={dispatch} currentRoomId={currentRoomId} />
        ))}
      </section>
    </>
  );
}
