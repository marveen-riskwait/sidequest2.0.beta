const BASE = import.meta.env.VITE_BACKEND_URL;

const buildHeaders = (extra = {}) => {
  const token = localStorage.getItem("token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
};

const handleResponse = async (res) => {
  if (res.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    if (!window.location.pathname.includes("/login")) {
      window.location.href = "/login";
    }
    throw new Error("Session expired");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.msg || `Error ${res.status}`);
  return data;
};

export const api = {
  get:  (path)         => fetch(`${BASE}/api${path}`, { headers: buildHeaders() }).then(handleResponse),
  post: (path, body)   => fetch(`${BASE}/api${path}`, { method: "POST",   headers: buildHeaders(), body: JSON.stringify(body || {}) }).then(handleResponse),
  put:  (path, body)   => fetch(`${BASE}/api${path}`, { method: "PUT",    headers: buildHeaders(), body: JSON.stringify(body || {}) }).then(handleResponse),
  del:  (path)         => fetch(`${BASE}/api${path}`, { method: "DELETE", headers: buildHeaders() }).then(handleResponse),
};