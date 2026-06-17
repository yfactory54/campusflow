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

interface TaskFormProps {
  dispatch: React.Dispatch<TaskAction>;
  currentRoomId: number | null;
}

interface CreateTaskResponse {
  task: Task;
}

const emptyValues: TaskFormValues = {
  title: "",
  dueDate: "",
  priority: "medium",
  memo: "",
};

export default function TaskForm({ dispatch, currentRoomId }: TaskFormProps) {
  const [values, setValues] = useState<TaskFormValues>(emptyValues);
  const [errors, setErrors] = useState<TaskFormErrors>({});
  const { request: createTask, loading: addLoading, error: addError } = useFetch<CreateTaskResponse>();

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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors = validateTaskFormValues(values);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    if (!currentRoomId) {
      alert("선택된 방이 존재하지 않습니다.");
      return;
    }

    // 담당자는 서버가 로그인 세션 사용자 이름으로 지정하므로 전송하지 않는다.
    const result = await createTask(`rooms/${currentRoomId}/tasks`, {
      method: "POST",
      body: {
        title: values.title.trim(),
        dueDate: values.dueDate,
        priority: values.priority,
        memo: values.memo.trim(),
      },
    });

    if (!result.ok || !result.data?.task) {
      return;
    }

    dispatch({ type: "ADD_TASK", payload: { task: result.data.task } });
    setValues(emptyValues);
    setErrors({});
  };

  return (
    <>
      <section
        className="rounded-lg border border-line bg-white p-5"
        aria-label="업무 입력"
      >
        <div className="mb-5">
          <h2 className="m-0 font-display text-2xl font-bold text-ink sm:text-[28px]">
            새 업무 등록
          </h2>
          <p className="mt-1 text-sm text-muted">
            필수 항목은 업무명과 마감일입니다. 담당자는 로그인한 사용자로 자동 지정됩니다.
          </p>
        </div>

        {addError && (
          <div className="message error mb-4">
            {addError}
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

          <button
            type="submit"
            className="btn primary"
            disabled={addLoading}
          >
            {addLoading ? "업무 추가 중..." : "업무 추가"}
          </button>
        </form>
      </section>
    </>
  );
}
