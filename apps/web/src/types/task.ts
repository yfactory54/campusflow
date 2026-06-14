
export type TaskPriority = 'low' | 'medium' | 'high';

export type TaskStatus = 'todo' | 'inProgress' | 'done';


export interface Task {
  id: string;
  title: string;
  dueDate: string;
  priority: TaskPriority;
  status: TaskStatus;
  assignee: string;
  memo: string;
  createdAt: string;
}

export interface TaskFormValues {
  title: string;
  dueDate: string;
  priority: TaskPriority;
  memo: string;
}

export type TaskSortKey = 'dueDate' | 'priority' | 'createdAt';

export interface TaskFilters {
  query: string;
  priority: TaskPriority | 'all';
  status: TaskStatus | 'all';
  sortBy: TaskSortKey;
}

export type TaskAction =
  | { type: 'ADD_TASK'; payload: { task: Task } }
  | { type: 'UPDATE_TASK'; payload: { id: string; values: TaskFormValues } }
  | { type: 'DELETE_TASK'; payload: { id: string } }
  | { type: 'CHANGE_STATUS'; payload: { id: string; status: TaskStatus } }
  | { type: 'SET_TASKS'; payload: { tasks: Task[] } };
