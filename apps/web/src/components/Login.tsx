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

        const data = await login("login", {
            method: "POST",
            body: { email, password },
        });
        if (!data || !data.token || !data.user) {
            return;
        }

        localStorage.setItem("authToken", data.token);

        if (rememberMe) {
            localStorage.setItem("savedEmail", email);
            localStorage.setItem("rememberMe", "true");
        } else {
            localStorage.removeItem("savedEmail");
            localStorage.removeItem("rememberMe");
        }
        onLoginSuccess(data.user);
    };

    return (
        <div className="auth-page">
            <div className="card">
                <h1 className="title">로그인</h1>
                <p className="help">계속하려면 세부 정보를 입력하세요.</p>
                {fetchError && (
                    <p className="message error">
                        {fetchError}
                    </p>
                )}
                <form className="form-grid" onSubmit={handleSubmit}>
                    <div className="field-block">
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

                    <div className="field-block">
                        <div className="password-field">
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
                                className="password-toggle"
                                onClick={toggleShowPassword}
                            >
                                <img
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

                    <div className="checkbox-row">
                        <input
                            type="checkbox"
                            id="chk"
                            className="checkbox"
                            checked={rememberMe}
                            onChange={handleMeChange}
                        />
                        <label
                            htmlFor="chk"
                            className="checkbox-label"
                        >
                            아이디 저장
                        </label>
                    </div>

                    <button
                        type="submit"
                        className="btn primary login"
                        disabled={loading}
                    >
                        {loading ? "로그인 중..." : "로그인"}
                    </button>
                </form>
            </div>
        </div>
    );
}
