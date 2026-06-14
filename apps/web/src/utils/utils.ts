import type { TaskFormValues, TaskPriority, TaskStatus } from '../types/task';
import { isValidDateInput } from './dateUtils';


export const priorityLabels: Record<TaskPriority, string> = {
  low: '낮음',
  medium: '보통',
  high: '높음',
};

export const statusLabels: Record<TaskStatus, string> = {
  todo: '할 일',
  inProgress: '진행 중',
  done: '완료',
};

export const priorityRanks: Record<TaskPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export interface TaskFormErrors {
  title?: string;
  dueDate?: string;
}

export const validateTaskFormValues = (values: TaskFormValues): TaskFormErrors => {
  const errors: TaskFormErrors = {};

  if (!values.title.trim()) {
    errors.title = '업무명을 입력하세요.';
  }

  if (!values.dueDate) {
    errors.dueDate = '마감일을 선택하세요.';
  } else if (!isValidDateInput(values.dueDate)) {
    errors.dueDate = '올바른 마감일을 선택하세요.';
  }

  return errors;
};
