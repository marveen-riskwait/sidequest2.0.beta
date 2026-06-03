import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
	Container,
	Card,
	Form,
	Button,
	Alert,
	Spinner,
} from "react-bootstrap";
import useGlobalReducer from "../hooks/useGlobalReducer";
import { FiAtSign, FiLock, FiLogIn } from "react-icons/fi";

// Style coherent avec Friends / Profile / EventModal (dark mode, accents indigo)
const AUTH_CSS = `
.sq-auth-wrap {
	min-height: 100vh;
	display: flex;
	align-items: center;
	justify-content: center;
	background: radial-gradient(circle at top, #1a1d29 0%, #0b0d13 70%);
	padding: 4rem 1rem 2rem;
}
.sq-auth-card {
	background: #161922;
	color: #e9ecef;
	border: 1px solid #262a36;
	border-radius: 14px;
	max-width: 420px;
	width: 100%;
	box-shadow: 0 10px 40px rgba(0,0,0,0.4);
}
.sq-auth-card .form-control,
.sq-auth-card .form-control:focus {
	background-color: #0f111a !important;
	color: #e9ecef !important;
	border-color: #2a2f42 !important;
	box-shadow: none;
}
.sq-auth-card .form-control::placeholder { color: #6c757d; }
.sq-auth-card .form-label {
	color: #adb5bd;
	font-size: 0.78rem;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	margin-bottom: 0.35rem;
}
.sq-auth-title {
	font-weight: 700;
	background: linear-gradient(135deg, #6366f1, #ec4899);
	-webkit-background-clip: text;
	-webkit-text-fill-color: transparent;
	background-clip: text;
}
.sq-auth-submit {
	background: linear-gradient(135deg, #6366f1, #4f46e5);
	border: none;
	font-weight: 600;
}
.sq-auth-submit:hover,
.sq-auth-submit:focus {
	background: linear-gradient(135deg, #4f46e5, #4338ca);
}
.sq-auth-link {
	color: #6366f1;
	text-decoration: none;
	font-weight: 600;
}
.sq-auth-link:hover { color: #ec4899; }
`;

// Persist the logged-in user safely. Refuses to write anything that isn't
// a plain object (so we never end up with the literal string "undefined"
// in localStorage, which crashes initialStore on next boot).
const safePersistUser = (user) => {
	if (user && typeof user === "object") {
		localStorage.setItem("user", JSON.stringify(user));
		return true;
	}
	localStorage.removeItem("user");
	return false;
};

const safePersistToken = (token) => {
	if (typeof token === "string" && token.length > 0) {
		localStorage.setItem("token", token);
		return true;
	}
	localStorage.removeItem("token");
	return false;
};

export const Login = () => {
	const navigate = useNavigate();
	const { dispatch } = useGlobalReducer();

	const [identifier, setIdentifier] = useState("");
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");

	const handleLogin = async (e) => {
		e.preventDefault();
		setError("");
		setLoading(true);

		try {
			const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				// Backend accepts identifier|email|username — `identifier`
				// is the cleanest because it covers both cases.
				body: JSON.stringify({ identifier, password }),
			});

			const data = await response.json().catch(() => ({}));

			if (!response.ok) {
				setError(data.msg || "Login error");
				return;
			}

			// Guard: refuse to persist incomplete responses. Without this an
			// unexpected payload (e.g. backend hiccup) would write the literal
			// string "undefined" to localStorage and break the next boot.
			if (!safePersistToken(data.token) || !safePersistUser(data.user)) {
				setError("Invalid response from server (missing token or user)");
				return;
			}

			dispatch({ type: "set_user", payload: data.user });
			navigate("/");
		} catch (err) {
			console.error("Login error:", err);
			setError("Server error");
		} finally {
			setLoading(false);
		}
	};

	return (
		<>
			<style>{AUTH_CSS}</style>

			<div className="sq-auth-wrap">
				<Container className="d-flex justify-content-center">
					<Card className="sq-auth-card p-4">
						<h2 className="sq-auth-title text-center mb-1">
							<img
								src="src/front/assets/img/logoSideQuest.png"
								alt="SideQuest"
								style={{ filter: "brightness(0) invert(1)", height: "60px", width: "auto" }} />
						</h2>
						<p className="text-center text-secondary mb-4">Welcome back to your SideQuest!</p>

						{error && (
							<Alert variant="danger" onClose={() => setError("")} dismissible>
								{error}
							</Alert>
						)}

						<Form onSubmit={handleLogin}>
							<Form.Group className="mb-3">
								<Form.Label>
									<FiAtSign className="me-2" /> Email o username
								</Form.Label>
								<Form.Control
									type="text"
									value={identifier}
									onChange={(e) => setIdentifier(e.target.value)}
									placeholder="alex@example.com o alexchen"
									required
									autoComplete="username"
								/>
							</Form.Group>

							<Form.Group className="mb-4">
								<Form.Label>
									<FiLock className="me-2" /> Password
								</Form.Label>
								<Form.Control
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder="Enter password"
									required
								/>
							</Form.Group>

							<Button
								type="submit"
								className="sq-auth-submit w-100 py-2"
								disabled={loading}
							>
								{loading
									? <><Spinner size="sm" animation="border" /> Logging in...</>
									: <><FiLogIn className="me-2" /> Login</>
								}
							</Button>
						</Form>

						<div className="text-center mt-4 text-secondary small">
							No tienes cuenta ?{" "}
							<Link to="/register" className="sq-auth-link">
								Crear cuenta
							</Link>
						</div>
					</Card>
				</Container>
			</div>
		</>
	);
};

export default Login;