import { useEffect, useMemo, useReducer, useState } from 'react';
import DashboardSummary from './components/DashboardSummary';
import FilterBar from './components/FilterBar';
import Header from './components/Header';
import TaskForm from './components/TaskForm';
import TaskList from './components/TaskList';
import Login from './components/Login';
import RoomList from './components/RoomList';
import TeamManager from './components/TeamManager';
import AdminPanel from './components/AdminPanel';
import { taskReducer } from './reducers/taskReducer';
import { priorityRanks } from './utils/utils';
import type { Task, TaskFilters } from './types/task';
import type { AuthUser } from './types/user';
import useFetch from './fetch/useFetch';

// vite.config 의 define 으로 주입(기본 "/api/").
declare const __API_BASE__: string;

interface TasksResponse {
  tasks: Task[];
}

interface MeResponse {
  user: AuthUser;
}

const initialFilters: TaskFilters = {
  query: '',
  priority: 'all',
  status: 'all',
  sortBy: 'dueDate',
};

type View = 'login' | 'roomList' | 'dashboard' | 'admin';

export default function App() {
  const [view, setView] = useState<View>('login');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(() => Boolean(localStorage.getItem('authToken')));
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [selectedRoomName, setSelectedRoomName] = useState<string>('');
  const [tasks, dispatch] = useReducer(taskReducer, []);
  const [filters, setFilters] = useState<TaskFilters>(initialFilters);
  const [showTeamManager, setShowTeamManager] = useState(false);

  const { request: fetchTasks, loading: tasksLoading, error: tasksError } = useFetch<TasksResponse>();
  const { request: fetchMe } = useFetch<MeResponse>();

  const handleLogout = () => {
    const token = localStorage.getItem('authToken');
    if (token) {
      // best-effort 서버 통지(stateless 이므로 결과는 무시)
      fetch(`${__API_BASE__}logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem('authToken');
    setCurrentUser(null);
    setSelectedRoomId(null);
    setSelectedRoomName('');
    setView('login');
  };

  // 세션 복원: 저장된 토큰이 있으면 /api/me 로 사용자 확인
  useEffect(() => {
    if (!localStorage.getItem('authToken')) {
      return;
    }
    const restore = async () => {
      const data = await fetchMe('me');
      if (data?.user) {
        setCurrentUser(data.user);
        setView('roomList');
      } else {
        localStorage.removeItem('authToken');
      }
      setInitializing(false);
    };
    restore();
  }, [fetchMe]);

  // 세션 만료(401) 시 로그인 화면으로 복귀
  useEffect(() => {
    const onExpired = () => {
      setCurrentUser(null);
      setSelectedRoomId(null);
      setSelectedRoomName('');
      setView('login');
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  useEffect(() => {
    if (selectedRoomId) {
      const loadTasksFromServer = async () => {
        const data = await fetchTasks(`rooms/${selectedRoomId}/tasks`);
        if (data && data.tasks) {
          dispatch({ type: 'SET_TASKS', payload: { tasks: data.tasks } });
        }
      };
      loadTasksFromServer();
    }
  }, [selectedRoomId, fetchTasks]);

  const filteredTasks = useMemo(() => {
    const query = filters.query.trim().toLowerCase();

    return [...tasks]
      .filter((task) => {
        const matchesQuery =
          !query ||
          task.title.toLowerCase().includes(query) ||
          task.assignee.toLowerCase().includes(query) ||
          task.memo.toLowerCase().includes(query);
        const matchesPriority = filters.priority === 'all' || task.priority === filters.priority;
        const matchesStatus = filters.status === 'all' || task.status === filters.status;

        return matchesQuery && matchesPriority && matchesStatus;
      })
      .sort((leftTask, rightTask) => {
        if (filters.sortBy === 'priority') {
          return priorityRanks[rightTask.priority] - priorityRanks[leftTask.priority];
        }

        if (filters.sortBy === 'createdAt') {
          return new Date(rightTask.createdAt).getTime() - new Date(leftTask.createdAt).getTime();
        }

        return new Date(leftTask.dueDate).getTime() - new Date(rightTask.dueDate).getTime();
      });
  }, [filters, tasks]);

  if (initializing) {
    return (
      <div className="status-container">
        <div className="message info">세션을 확인하는 중...</div>
      </div>
    );
  }

  if (view === 'login' || !currentUser) {
    return (
      <Login
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setView('roomList');
        }}
      />
    );
  }
  if (view === 'admin') {
    return <AdminPanel currentUser={currentUser} onClose={() => setView('roomList')} />;
  }
  if (view === 'roomList') {
    return (
      <RoomList
        canCreateRoom={currentUser.role === 'admin' || currentUser.role === 'leader'}
        onSelectRoom={(roomId, roomName) => {
          setSelectedRoomId(roomId);
          setSelectedRoomName(roomName);
          setView('dashboard');
        }}
      />
    );
  }
  return (
    <>
      <Header
        totalCount={tasks.length}
        completedCount={tasks.filter((task) => task.status === 'done').length}
        currentRoomName={selectedRoomName}
        currentUser={currentUser}
        onBackToRoomList={() => setView('roomList')}
        onOpenTeamManager={() => setShowTeamManager(true)}
        onOpenAdmin={() => setView('admin')}
        onLogout={handleLogout}
      />

      {showTeamManager && selectedRoomId && (
        <TeamManager
          roomId={selectedRoomId}
          tasks={tasks}
          onClose={() => setShowTeamManager(false)}
        />
      )}

      {tasksLoading && (
        <div className="status-container">
          <div className="message info">
            실시간 업무 목록을 원격지 서버에서 안전하게 동기화 중...
          </div>
        </div>
      )}

      {tasksError && (
        <div className="status-container">
          <div className="message error">
            {tasksError}
          </div>
        </div>
      )}

      <main className="app-main">
        <div className="app-column">
          <TaskForm dispatch={dispatch} currentRoomId={selectedRoomId} />
        </div>

        <div className="app-column">
          <DashboardSummary tasks={tasks} />
          <FilterBar filters={filters} resultCount={filteredTasks.length} onFilterChange={setFilters} />
          <TaskList tasks={filteredTasks} totalCount={tasks.length} dispatch={dispatch} currentRoomId={selectedRoomId} />
        </div>
      </main>
    </>
  );
};
