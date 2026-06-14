import { useState } from "react";
import type React from "react";
import type { Task, TaskAction, TaskStatus } from "../types/task";
import { formatDueDate, getDueLabel, getDueTone } from "../utils/dateUtils";
import useFetch from "../fetch/useFetch";

import {
  priorityLabels,
  statusLabels,
} from "../utils/utils";
import TaskEditForm from "./TaskEditForm";

interface TaskItemProps {
  task: Task;
  dispatch: React.Dispatch<TaskAction>;
  currentRoomId: number | null;
}

const priorityClassNames: Record<Task["priority"], string> = {
  high: "priority-high",
  medium: "priority-medium",
  low: "priority-low",
};

const dueToneClassNames: Record<ReturnType<typeof getDueTone>, string> = {
  danger: "due-danger",
  warning: "due-warning",
  normal: "due-normal",
};

const nextStatusByStatus: Record<TaskStatus, TaskStatus> = {
  todo: "inProgress",
  inProgress: "done",
  done: "todo",
};

const statusButtonLabels: Record<TaskStatus, string> = {
  todo: "진행 시작",
  inProgress: "완료 처리",
  done: "다시 할 일",
};

export default function TaskItem({ task, dispatch, currentRoomId }: TaskItemProps) {
  const [isEditing, setIsEditing] = useState(false);

  const { request: deleteTask } = useFetch();
  const { request: editTask } = useFetch<{ task: Task }>();

  const handleEditClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    setIsEditing(true);

    event.currentTarget.blur();
  };

  const handleDeleteClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.blur();

    if (!confirm("정말 삭제하시겠습니까?")) {
      return;
    }

    await deleteTask(`rooms/${currentRoomId}/tasks/${task.id}`, { method: "DELETE" });
    dispatch({ type: "DELETE_TASK", payload: { id: task.id } });
  };

  const handleStatusButtonClick = async (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event.currentTarget.blur();
    const nextStatus = nextStatusByStatus[task.status];
    await editTask(`rooms/${currentRoomId}/tasks/${task.id}`, {
      method: "PATCH",
      body: { status: nextStatus },
    });
    dispatch({
      type: "CHANGE_STATUS",
      payload: { id: task.id, status: nextStatus },
    });
  };

  if (isEditing) {
    return (
      <TaskEditForm
        task={task}
        dispatch={dispatch}
        currentRoomId={currentRoomId}
        onCancel={() => {
          setIsEditing(false);
        }}
      />
    );
  }

  return (
    <>
      <article className="task-card">
        <div className="header">
          <div className="title-block">
            <div className="badge-row">
              <span
                className={`badge ${priorityClassNames[task.priority]}`}
              >
                {priorityLabels[task.priority]}
              </span>
            </div>
            <h3 className="title">
              {task.title}
            </h3>
            <p className="assignee">
              담당자: {task.assignee || "미지정"}
            </p>
          </div>

          <div className="actions">
            <button
              type="button"
              onClick={handleStatusButtonClick}
              className="action-btn status"
            >
              {statusButtonLabels[task.status]}
            </button>
            <button
              type="button"
              onClick={handleEditClick}
              className="action-btn edit"
            >
              수정
            </button>
            <button
              type="button"
              onClick={handleDeleteClick}
              className="action-btn delete"
            >
              삭제
            </button>
          </div>
        </div>

        {task.memo && (
          <p className="memo">
            {task.memo}
          </p>
        )}

        <div className="meta-grid">
          <div>
            <p className="meta-label">
              마감
            </p>
            <p className="meta-value">
              {formatDueDate(task.dueDate)}
            </p>
            <p
              className={`due-tone ${dueToneClassNames[getDueTone(task.dueDate)]}`}
            >
              {getDueLabel(task.dueDate)}
            </p>
          </div>


          <div>
            <p className="meta-label">
              현재 상태
            </p>
            <p className="status-value">
              {statusLabels[task.status]}
            </p>
          </div>
        </div>
      </article>
    </>
  );
}
