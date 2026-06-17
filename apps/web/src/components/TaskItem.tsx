import { useEffect, useState } from "react";
import type React from "react";
import type { Task, TaskAction, TaskStatus } from "../types/task";
import type { AuthUser } from "../types/user";
import { formatDueDate, getDueLabel, getDueTone } from "../utils/dateUtils";
import useFetch from "../fetch/useFetch";

import {
  priorityLabels,
  statusLabels,
} from "../utils/utils";
import TaskEditForm from "./TaskEditForm";
import TaskComments from "./TaskComments";

interface TaskItemProps {
  task: Task;
  dispatch: React.Dispatch<TaskAction>;
  currentRoomId: number | null;
  currentUser: AuthUser;
}

interface Member {
  id: number;
  name: string;
}

const priorityClassNames: Record<Task["priority"], string> = {
  high: "text-danger",
  medium: "text-warn",
  low: "text-info",
};

const dueToneClassNames: Record<ReturnType<typeof getDueTone>, string> = {
  danger: "text-danger",
  warning: "text-info",
  normal: "text-brand",
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

export default function TaskItem({ task, dispatch, currentRoomId, currentUser }: TaskItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);

  const canReassign = currentUser.role === "admin" || currentUser.role === "leader";
  const { request: deleteTask, error: deleteError } = useFetch();
  const { request: editTask, error: editError } = useFetch<{ task: Task }>();
  const { request: fetchMembers } = useFetch<{ members: Member[] }>();

  useEffect(() => {
    if (!canReassign || !currentRoomId) return;
    const loadMembers = async () => {
      const result = await fetchMembers(`rooms/${currentRoomId}/members`);
      if (result.ok && result.data?.members) setMembers(result.data.members);
    };
    loadMembers();
  }, [canReassign, currentRoomId, fetchMembers]);

  const handleEditClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    setIsEditing(true);

    event.currentTarget.blur();
  };

  const handleDeleteClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.blur();

    if (!confirm("정말 삭제하시겠습니까?")) {
      return;
    }

    const result = await deleteTask(`rooms/${currentRoomId}/tasks/${task.id}`, { method: "DELETE" });
    if (!result.ok) return;
    dispatch({ type: "DELETE_TASK", payload: { id: task.id } });
  };

  const handleStatusButtonClick = async (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event.currentTarget.blur();
    const nextStatus = nextStatusByStatus[task.status];
    const result = await editTask(`rooms/${currentRoomId}/tasks/${task.id}`, {
      method: "PATCH",
      body: { status: nextStatus },
    });
    if (!result.ok) return;
    dispatch({
      type: "CHANGE_STATUS",
      payload: { id: task.id, status: nextStatus },
    });
  };

  const handleAssigneeChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const assigneeId = Number(event.target.value);
    const result = await editTask(`rooms/${currentRoomId}/tasks/${task.id}`, {
      method: "PATCH",
      body: { assigneeId },
    });
    if (!result.ok || !result.data?.task) return;
    dispatch({
      type: "CHANGE_ASSIGNEE",
      payload: { id: task.id, assignee: result.data.task.assignee },
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
      <article className="rounded-lg border border-line bg-white p-5 transition-transform hover:-translate-y-0.5">
      {(deleteError || editError) && (
        <div className="message error mb-3">
          {deleteError || editError}
        </div>
      )}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap gap-2">
              <span
                className={`rounded-md border border-current bg-white px-2.5 py-[5px] text-xs font-extrabold ${priorityClassNames[task.priority]}`}
              >
                {priorityLabels[task.priority]}
              </span>
            </div>
            <h3 className="m-0 font-display text-2xl font-bold text-ink [overflow-wrap:anywhere] sm:text-[28px]">
              {task.title}
            </h3>
            <p className="mt-1 text-sm font-bold text-info">
              담당자: {task.assignee || "미지정"}
            </p>
            {canReassign && members.length > 0 && (
              <label className="mt-2 block text-xs font-bold text-muted">
                담당자 재배정
                <select className="control mt-1" value="" onChange={handleAssigneeChange}>
                  <option value="">팀원 선택</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="flex flex-row flex-wrap gap-2 sm:min-w-[128px] sm:flex-col">
            <button
              type="button"
              onClick={handleStatusButtonClick}
              className="min-w-[88px] flex-1 whitespace-nowrap rounded-md border border-brand bg-white px-4 py-3 text-sm font-bold text-brand hover:bg-[#d8efe3] sm:w-full sm:flex-none"
            >
              {statusButtonLabels[task.status]}
            </button>
            <button
              type="button"
              onClick={handleEditClick}
              className="min-w-[88px] flex-1 whitespace-nowrap rounded-md border border-info bg-white px-4 py-3 text-sm font-bold text-info hover:bg-[#e0ecf4] sm:w-full sm:flex-none"
            >
              수정
            </button>
            <button
              type="button"
              onClick={handleDeleteClick}
              className="min-w-[88px] flex-1 whitespace-nowrap rounded-md border border-danger bg-white px-4 py-3 text-sm font-bold text-danger hover:bg-[#fde8e6] sm:w-full sm:flex-none"
            >
              삭제
            </button>
            <button
              type="button"
              onClick={() => setShowComments((current) => !current)}
              className="min-w-[88px] flex-1 whitespace-nowrap rounded-md border border-line bg-white px-4 py-3 text-sm font-bold text-ink hover:bg-gray-50 sm:w-full sm:flex-none"
            >
              댓글
            </button>
          </div>
        </div>

        {task.memo && (
          <p className="mt-4 whitespace-pre-line leading-[1.7] text-[#555555] [overflow-wrap:anywhere]">
            {task.memo}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
          <div>
            <p className="m-0 text-xs font-extrabold uppercase tracking-[0.12em] text-[#999999]">
              마감
            </p>
            <p className="mt-1 font-bold">
              {formatDueDate(task.dueDate)}
            </p>
            <p
              className={`mt-1 font-bold ${dueToneClassNames[getDueTone(task.dueDate)]}`}
            >
              {getDueLabel(task.dueDate)}
            </p>
          </div>


          <div>
            <p className="m-0 text-xs font-extrabold uppercase tracking-[0.12em] text-[#999999]">
              현재 상태
            </p>
            <p className="mt-1 text-lg font-bold text-brand">
              {statusLabels[task.status]}
            </p>
          </div>
        </div>
        {showComments && currentRoomId && <TaskComments roomId={currentRoomId} taskId={task.id} />}
      </article>
    </>
  );
}
