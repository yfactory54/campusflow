import type React from "react";
import type { TaskFilters } from "../types/task";
import { priorityLabels, statusLabels } from "../utils/utils";

interface FilterBarProps {
  filters: TaskFilters;
  resultCount: number;
  onFilterChange: React.Dispatch<React.SetStateAction<TaskFilters>>;
}

export default function FilterBar({
  filters,
  resultCount,
  onFilterChange,
}: FilterBarProps) {
  const handleQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange((currentFilters) => ({
      ...currentFilters,
      query: event.target.value,
    }));
  };

  const handleSelectChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = event.target;

    switch (name) {
      case "status":
        onFilterChange((currentFilters) => ({
          ...currentFilters,
          status: value as TaskFilters["status"],
        }));
        break;
      case "priority":
        onFilterChange((currentFilters) => ({
          ...currentFilters,
          priority: value as TaskFilters["priority"],
        }));
        break;
      case "sortBy":
        onFilterChange((currentFilters) => ({
          ...currentFilters,
          sortBy: value as TaskFilters["sortBy"],
        }));
        break;
    }
  };

  return (
    <>
      <section
        className="filter-card"
        aria-label="검색과 필터"
      >
        <div className="heading">
          <h2 className="title">
            업무 보드
          </h2>
          <span className="badge">
            {resultCount}개 표시
          </span>
        </div>

        <div className="grid">
          <label className="field compact">
            검색
            <input
              name="query"
              value={filters.query}
              onChange={handleQueryChange}
              className="control"
              placeholder="업무명, 담당자, 메모 검색"
            />
          </label>

          <label className="field compact">
            상태
            <select
              name="status"
              value={filters.status}
              onChange={handleSelectChange}
              className="control"
            >
              <option value="all">전체</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="field compact">
            우선순위
            <select
              name="priority"
              value={filters.priority}
              onChange={handleSelectChange}
              className="control"
            >
              <option value="all">전체</option>
              {Object.entries(priorityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="field compact">
            정렬
            <select
              name="sortBy"
              value={filters.sortBy}
              onChange={handleSelectChange}
              className="control"
            >
              <option value="dueDate">마감일</option>
              <option value="priority">우선순위</option>
              <option value="createdAt">등록순</option>
            </select>
          </label>
        </div>
      </section>
    </>
  );
}
