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
import { FiMail, FiLock, FiUserPlus, FiAtSign } from "react-icons/fi";

// Style coherent avec Friends / Profile / EventModal (dark mode, accents indigo).
const AUTH_CSS = `
.sq-auth-wrap {
	min-height: 100vh;
	display: flex;
	align-items: center;
	justify-content: center;
	background: radial-gradient(circle at top, #1a1d29 0%, #0b0d13 70%);
	padding: 2rem 1rem;
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
.sq-auth-hint {
	color: #6c757d;
	font-size: 0.72rem;
	margin-top: 0.25rem;
}
`;

export const Register = () => {
	const navigate = useNavigate();

	const [email, setEmail] = useState("");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");

	const handleRegister = async (e) => {
		e.preventDefault();
		setError("");
		setLoading(true);

		try {
			const response = await fetch(
				`${import.meta.env.VITE_BACKEND_URL}/api/register`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ email, username, password }),
				}
			);

			const data = await response.json().catch(() => ({}));

			if (!response.ok) {
				setError(data.msg || "Error creating user");
				return;
			}

			navigate("/login");
		} catch (err) {
			console.error("Register error:", err);
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
								style={{ filter: "brightness(0) invert(1)", height: "60px", width: "auto" }}
							/>
						</h2>
						<p className="text-center text-secondary mb-4">Your SideQuest waits for you!</p>

						{error && (
							<Alert variant="danger" onClose={() => setError("")} dismissible>
								{error}
							</Alert>
						)}

						<Form onSubmit={handleRegister}>
							<Form.Group className="mb-3">
								<Form.Label>
									<FiMail className="me-2" /> Email
								</Form.Label>
								<Form.Control
									type="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									placeholder="alex@example.com"
									required
									autoComplete="email"
								/>
							</Form.Group>

							<Form.Group className="mb-3">
								<Form.Label>
									<FiAtSign className="me-2" /> Username
								</Form.Label>
								<Form.Control
									type="text"
									value={username}
									onChange={(e) => setUsername(e.target.value)}
									placeholder="alexchen"
									required
									minLength={3}
									maxLength={30}
									pattern="[A-Za-z0-9._-]{3,30}"
									autoComplete="username"
								/>
								<div className="sq-auth-hint">
									3-30 caracteres · letras, dígitos, . _ -
								</div>
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
									minLength={6}
									autoComplete="new-password"
								/>
							</Form.Group>

							<Button
								type="submit"
								className="sq-auth-submit w-100 py-2"
								disabled={loading}
							>
								{loading
									? <><Spinner size="sm" animation="border" /> Creating...</>
									: <><FiUserPlus className="me-2" /> Register</>
								}
							</Button>
						</Form>

						<div className="text-center mt-4 text-secondary small">
							Ya tienes cuenta?{" "}
							<Link to="/login" className="sq-auth-link">
								Iniciar sesion
							</Link>
						</div>
					</Card>
				</Container>
			</div>
		</>
	);
};

export default Register;
