import { useState, useCallback } from "react";

type JsonRecord = Record<string, unknown>;
type RequestBody = JsonRecord | FormData | string | null;

interface FetchOptions {
    method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
    headers?: HeadersInit;
    body?: RequestBody;
}

type FetchResult<T> =
    | { ok: true; data: T | null }
    | { ok: false; error: string };

// vite.config 의 define 으로 주입. 기본은 같은 도메인 상대경로 "/api/".
declare const __API_BASE__: string;
const API_BASE = __API_BASE__;

const isJsonBody = (body: RequestBody | undefined): body is JsonRecord => {
    return Boolean(body) && typeof body === "object" && !(body instanceof FormData);
};

const getResponseErrorMessage = (value: unknown): string | null => {
    if (!value || typeof value !== "object" || !("error" in value)) {
        return null;
    }

    const { error } = value;
    return typeof error === "string" ? error : null;
};

function useFetch<T = unknown>() {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const request = useCallback(async (url: string, options: FetchOptions = {}): Promise<FetchResult<T>> => {
        setLoading(true);
        setError(null);
        try {
            const { method = "GET", headers = {}, body } = options;
            const token = localStorage.getItem("authToken");

            const reqHeaders: HeadersInit = {
                ...headers,
                ...(isJsonBody(body) ? { "Content-Type": "application/json" } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            };

            const response = await window.fetch(`${API_BASE}${url}`, {
                method,
                headers: reqHeaders,
                body: isJsonBody(body) ? JSON.stringify(body) : body,
            });

            let responseData: T | null = null;
            const contentType = response.headers.get("content-type");
            if (response.status !== 204 && contentType && contentType.includes("application/json")) {
                responseData = await response.json();
            }

            if (!response.ok) {
                // 세션 만료/무효 토큰: 토큰 정리 후 로그인 화면으로 복귀하도록 알림
                if (response.status === 401 && token) {
                    localStorage.removeItem("authToken");
                    window.dispatchEvent(new CustomEvent("auth:expired"));
                }
                const message = getResponseErrorMessage(responseData) || "요청 처리에 실패했습니다.";
                setError(message);
                return { ok: false, error: message };
            }

            setData(responseData);
            return { ok: true, data: responseData };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "에러가 발생했습니다.";
            setError(message);
            return { ok: false, error: message };
        } finally {
            setLoading(false);
        }
    }, []);

    return { request, data, loading, error };
}

export default useFetch;
