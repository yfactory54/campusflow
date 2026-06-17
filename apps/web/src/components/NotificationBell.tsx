import { useCallback, useEffect, useState } from "react";
import useFetch from "../fetch/useFetch";

interface Notification {
  id: number;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const { request: fetchNotifications } = useFetch<{ notifications: Notification[]; unreadCount: number }>();
  const { request: markRead } = useFetch<{ ok: boolean; unreadCount: number }>();

  const load = useCallback(async (unreadOnly = false) => {
    const result = await fetchNotifications(`me/notifications${unreadOnly ? "?unread=1" : ""}`);
    if (result.ok && result.data) {
      setNotifications(result.data.notifications);
      setUnreadCount(result.data.unreadCount);
    }
  }, [fetchNotifications]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const handleToggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) load(false);
  };

  const handleReadAll = async () => {
    const result = await markRead("me/notifications/read-all", { method: "POST" });
    if (result.ok) {
      setUnreadCount(0);
      setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    }
  };

  return (
    <div className="relative">
      <button type="button" className="btn secondary toggle relative" onClick={handleToggle} aria-label="알림">
        알림
        {unreadCount > 0 && (
          <span className="ml-2 rounded-full bg-danger px-2 py-0.5 text-xs text-white">{unreadCount}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-[120] mt-2 w-[320px] rounded-xl border border-line bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2">
            <strong className="text-sm text-ink">알림</strong>
            <button type="button" className="admin-btn" onClick={handleReadAll}>모두 읽음</button>
          </div>
          {notifications.length === 0 ? (
            <p className="py-3 text-center text-sm text-muted">알림이 없습니다.</p>
          ) : (
            <ul className="m-0 grid max-h-[280px] list-none gap-2 overflow-y-auto p-0">
              {notifications.map((notification) => (
                <li key={notification.id} className={`rounded-md p-2 text-sm ${notification.readAt ? "bg-gray-50 text-muted" : "bg-[#d8efe3] text-ink"}`}>
                  {notification.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
