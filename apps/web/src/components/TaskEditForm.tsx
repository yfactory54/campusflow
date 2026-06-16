import { useState } from "react";
import type React from "react";
import useFetch from "../fetch/useFetch";
import type {
  Task,
  TaskAction,
  TaskFormValues,
  TaskPriority,
} from "../types/task";
import {
  priorityLabels,
  validateTaskFormValues,
  type TaskFormErrors,
} from "../utils/utils";

interface TaskEditFormProps {
  task: Task;
  dispatch: React.Dispatch<TaskAction>;
  onCancel: () => void;
  currentRoomId: number | null;
}

const createValuesFromTask = (task: Task): TaskFormValues => ({
  title: task.title,
  dueDate: task.dueDate,
  priority: task.priority,
  memo: task.memo,
});

export default function TaskEditForm({
  task,
  dispatch,
  onCancel,
  currentRoomId,
}: TaskEditFormProps) {
  const [values, setValues] = useState<TaskFormValues>(() =>
    createValuesFromTask(task),
  );
  const [errors, setErrors] = useState<TaskFormErrors>({});
  const { request: updateTask, loading: saving, error: saveError } = useFetch<{ task: Task }>();

  const updateValue = <Key extends keyof TaskFormValues>(
    name: Key,
    value: TaskFormValues[Key],
  ) => {
    setValues((currentValues) => ({ ...currentValues, [name]: value }));
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;

    switch (name) {
      case "title":
      case "dueDate":
        updateValue(name, value);
        break;
    }
  };

  const handleTextAreaChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    updateValue("memo", event.target.value);
  };

  const handleSelectChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = event.target;

    switch (name) {
      case "priority":
        updateValue("priority", value as TaskPriority);
        break;
    }
  };

  const handleCancelClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.blur();
    onCancel();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors = validateTaskFormValues(values);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    // 수정 내용을 서버에 영구 반영(담당자/시간은 전송하지 않음).
    const data = await updateTask(`rooms/${currentRoomId}/tasks/${task.id}`, {
      method: "PATCH",
      body: {
        title: values.title.trim(),
        dueDate: values.dueDate,
        priority: values.priority,
        memo: values.memo.trim(),
      },
    });

    if (!data || !data.task) {
      return;
    }

    dispatch({ type: "UPDATE_TASK", payload: { id: task.id, values } });
    onCancel();
  };

  return (
    <>
      <article className="rounded-lg border-2 border-brand-edit bg-white p-5">
        <div className="mb-5">
          <p className="mb-1 text-sm font-extrabold text-brand">편집 모드</p>
          <h3 className="m-0 font-display text-2xl font-bold text-ink sm:text-[28px]">
            업무 수정
          </h3>
        </div>

        {saveError && (
          <div className="message error mb-4">
            {saveError}
          </div>
        )}

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className="field">
            업무명
            <input
              name="title"
              value={values.title}
              onChange={handleInputChange}
              className="control"
            />
            {errors.title && (
              <span className="error">
                {errors.title}
              </span>
            )}
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="field">
              마감일
              <input
                type="date"
                name="dueDate"
                value={values.dueDate}
                onChange={handleInputChange}
                className="control"
              />
              {errors.dueDate && (
                <span className="error">
                  {errors.dueDate}
                </span>
              )}
            </label>
            <label className="field">
              우선순위
              <select
                name="priority"
                value={values.priority}
                onChange={handleSelectChange}
                className="control"
              >
                {Object.entries(priorityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            메모
            <textarea
              name="memo"
              value={values.memo}
              onChange={handleTextAreaChange}
              rows={4}
              className="control textarea"
            />
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleCancelClick}
              className="btn secondary"
            >
              취소
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={saving}
            >
              {saving ? "저장 중..." : "수정 저장"}
            </button>
          </div>
        </form>
      </article>
    </>
  );
}
