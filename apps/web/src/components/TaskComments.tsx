import { useEffect, useState } from "react";
import useFetch from "../fetch/useFetch";

interface Comment {
  id: number;
  authorId: number;
  authorName: string;
  body: string;
  createdAt: string;
}

interface TaskCommentsProps {
  roomId: number;
  taskId: string;
}

export default function TaskComments({ roomId, taskId }: TaskCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState("");
  const { request: fetchComments } = useFetch<{ comments: Comment[] }>();
  const { request: createComment, loading: creating, error: createError } = useFetch<{ comment: Comment }>();
  const { request: deleteComment } = useFetch();

  useEffect(() => {
    const load = async () => {
      const result = await fetchComments(`rooms/${roomId}/tasks/${taskId}/comments`);
      if (result.ok && result.data?.comments) setComments(result.data.comments);
    };
    load();
  }, [fetchComments, roomId, taskId]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    const result = await createComment(`rooms/${roomId}/tasks/${taskId}/comments`, {
      method: "POST",
      body: { body: trimmed },
    });
    if (result.ok && result.data?.comment) {
      const nextComment = result.data.comment;
      setComments((current) => [...current, nextComment]);
      setBody("");
    }
  };

  const handleDelete = async (commentId: number) => {
    const result = await deleteComment(`rooms/${roomId}/tasks/${taskId}/comments/${commentId}`, { method: "DELETE" });
    if (result.ok) setComments((current) => current.filter((comment) => comment.id !== commentId));
  };

  return (
    <div className="mt-4 rounded-lg border border-line bg-gray-50 p-3">
      <h4 className="m-0 mb-3 text-sm font-bold text-ink">댓글</h4>
      {comments.length === 0 ? (
        <p className="text-sm text-muted">아직 댓글이 없습니다.</p>
      ) : (
        <ul className="m-0 mb-3 grid list-none gap-2 p-0">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-md bg-white p-2 text-sm">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted">
                <span>{comment.authorName}</span>
                <button type="button" className="admin-btn danger" onClick={() => handleDelete(comment.id)}>
                  삭제
                </button>
              </div>
              <p className="m-0 whitespace-pre-line text-ink">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form className="grid gap-2" onSubmit={handleSubmit}>
        <textarea
          className="control textarea"
          rows={2}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="댓글을 입력하세요"
        />
        {createError && <div className="message error">{createError}</div>}
        <button type="submit" className="btn secondary" disabled={creating}>
          {creating ? "등록 중..." : "댓글 등록"}
        </button>
      </form>
    </div>
  );
}
