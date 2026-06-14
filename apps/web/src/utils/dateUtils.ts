const dateInputPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export const toDateInputValue = (date: Date): string => {
  return date.toISOString().slice(0, 10);
};

export const getDaysUntilDue = (dueDate: string): number => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(`${dueDate}T00:00:00`);
  target.setHours(0, 0, 0, 0);

  const diffMs = target.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
};

export const formatDueDate = (dueDate: string): string => {
  const date = new Date(`${dueDate}T00:00:00`);
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
};

export const getDueLabel = (dueDate: string): string => {
  const days = getDaysUntilDue(dueDate);

  if (days < 0) {
    return `${Math.abs(days)}일 지남`;
  }

  if (days === 0) {
    return '오늘 마감';
  }

  if (days === 1) {
    return '내일 마감';
  }

  return `${days}일 남음`;
};

export const getDueTone = (dueDate: string): 'danger' | 'warning' | 'normal' => {
  const days = getDaysUntilDue(dueDate);

  if (days < 0 || days <= 2) {
    return 'danger';
  }

  if (days <= 7) {
    return 'warning';
  }

  return 'normal';
};

export const isValidDateInput = (dateValue: string): boolean => {
  const match = dateInputPattern.exec(dateValue);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

export const isOverdue = (dueDate: string): boolean => {
  if (!isValidDateInput(dueDate)) {
    return false;
  }

  return getDaysUntilDue(dueDate) < 0;
};

export const isDueSoon = (dueDate: string, thresholdDays = 3): boolean => {
  if (!isValidDateInput(dueDate)) {
    return false;
  }

  const daysUntilDue = getDaysUntilDue(dueDate);

  return daysUntilDue >= 0 && daysUntilDue <= thresholdDays;
};
