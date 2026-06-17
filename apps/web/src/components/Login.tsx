import { useState } from "react";
import { validateEmail, validatePassword } from "../utils/validation";
import useFetch from "../fetch/useFetch";
import type { AuthUser } from "../types/user";

interface LoginProps {
    onLoginSuccess: (user: AuthUser) => void;
}

interface LoginResponse {
    token: string;
    user: AuthUser;
}

export default function Login({ onLoginSuccess }: LoginProps) {
    const { request: login, loading, error: fetchError } = useFetch<LoginResponse>();
    const [email, setEmail] = useState(localStorage.getItem("savedEmail") || "");
    const [password, setPassword] = useState("");
    const [rememberMe, setRememberMe] = useState(
        localStorage.getItem("rememberMe") === "true" || false
    );

    const [emailError, setEmailError] = useState("");
    const [passwordError, setPasswordError] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setEmail(e.target.value);
        setEmailError(
            validateEmail(e.target.value) ? "" : "이메일이 유효하지 않습니다."
        );
    };
    const handlePwChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPassword(e.target.value);
        setPasswordError(
            validatePassword(e.target.value) ? "" : "비밀번호가 유효하지 않습니다."
        );
    };
    const handleMeChange = () => {
        setRememberMe((rememberMe) => !rememberMe);
    };
    const toggleShowPassword = () => {
        setShowPassword((showPassword) => !showPassword);
    };
    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validateEmail(email)) return;
        if (!validatePassword(password)) return;

        const result = await login("login", {
            method: "POST",
            body: { email, password },
        });
        if (!result.ok || !result.data?.token || !result.data.user) {
            return;
        }

        localStorage.setItem("authToken", result.data.token);

        if (rememberMe) {
            localStorage.setItem("savedEmail", email);
            localStorage.setItem("rememberMe", "true");
        } else {
            localStorage.removeItem("savedEmail");
            localStorage.removeItem("rememberMe");
        }
        onLoginSuccess(result.data.user);
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
            <div className="w-full max-w-[375px] rounded-xl border border-gray-300 bg-white px-6 py-10 text-gray-700">
                <h1 className="m-0 mb-2.5 font-display text-[22px] font-bold text-ink">로그인</h1>
                <p className="mb-5 text-sm">계속하려면 세부 정보를 입력하세요.</p>
                {fetchError && (
                    <p className="message error mb-4">
                        {fetchError}
                    </p>
                )}
                <form className="grid gap-4" onSubmit={handleSubmit}>
                    <div className="grid gap-2">
                        <input
                            type="email"
                            className="control"
                            placeholder="someone@example.com"
                            value={email}
                            onChange={handleEmailChange}
                            required
                        />
                        {emailError && (
                            <p className="error">
                                이메일이 유효하지 않습니다.
                            </p>
                        )}
                    </div>

                    <div className="grid gap-2">
                        <div className="relative">
                            <input
                                type={showPassword ? "text" : "password"}
                                className="control"
                                placeholder="Enter Password"
                                value={password}
                                onChange={handlePwChange}
                                required
                            />
                            <button
                                type="button"
                                className="absolute right-3 top-1/2 w-6 -translate-y-1/2 border-0 bg-transparent p-0"
                                onClick={toggleShowPassword}
                            >
                                <img
                                    className="block w-full"
                                    src={showPassword ? "/eyes.svg" : "/eyes-closed.svg"}
                                />
                            </button>
                        </div>

                        {passwordError && (
                            <p className="error">
                                비밀번호가 유효하지 않습니다.
                            </p>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="chk"
                            className="h-5 w-5 appearance-none rounded-[5px] border border-gray-700 bg-white bg-center bg-no-repeat checked:bg-gray-700 checked:bg-[url(/check-icon.svg)] checked:bg-[length:14px]"
                            checked={rememberMe}
                            onChange={handleMeChange}
                        />
                        <label
                            htmlFor="chk"
                            className="cursor-pointer text-sm text-gray-700"
                        >
                            아이디 저장
                        </label>
                    </div>

                    <button
                        type="submit"
                        className="btn primary h-11 w-full"
                        disabled={loading}
                    >
                        {loading ? "로그인 중..." : "로그인"}
                    </button>
                </form>
            </div>
        </div>
    );
}
