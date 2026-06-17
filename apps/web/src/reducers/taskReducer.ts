import type { Task, TaskAction } from "../types/task";

export const taskReducer = (tasks: Task[], action: TaskAction): Task[] => {
  switch (action.type) {
    case "ADD_TASK":
      return [action.payload.task, ...tasks];

    case "UPDATE_TASK":
      return tasks.map((task) =>
        task.id === action.payload.id
          ? {
              ...task,
              title: action.payload.values.title.trim(),
              dueDate: action.payload.values.dueDate,
              priority: action.payload.values.priority,
              memo: action.payload.values.memo.trim(),
            }
          : task,
      );

    case "DELETE_TASK":
      return tasks.filter((task) => task.id !== action.payload.id);

    case "CHANGE_STATUS":
      return tasks.map((task) =>
        task.id === action.payload.id
          ? { ...task, status: action.payload.status }
          : task,
      );

    case "CHANGE_ASSIGNEE":
      return tasks.map((task) =>
        task.id === action.payload.id
          ? { ...task, assignee: action.payload.assignee }
          : task,
      );

    case "SET_TASKS":
      return action.payload.tasks;

    default:
      return tasks;
  }
};
