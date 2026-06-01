// src/front/hooks/useNotifications.jsx
import { useCallback, useEffect, useRef } from "react";
import useGlobalReducer from "./useGlobalReducer.jsx";

const API = import.meta.env.VITE_BACKEND_URL;

const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const fetchWithRetry = async (url, options = {}) => {
    let delay = 400;
    for (;;) {
        try {
            const res = await fetch(url, options);
            return res;
        } catch (_) {
            await new Promise((r) => setTimeout(r, delay));
            delay = Math.min(delay * 2, 4000);
        }
    }
};

const handle = async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.msg || `Request failed (${res.status})`);
    return data;
};

export const useNotifications = ({ pollMs = 20000 } = {}) => {
    const { store, dispatch } = useGlobalReducer();
    const pollRef = useRef(null);

    const isLogged = !!localStorage.getItem("token");

    // ----- fetch list -----
    const fetchNotifications = useCallback(async () => {
        if (!localStorage.getItem("token")) return;
        try {
            const res = await fetchWithRetry(`${API}/api/notifications`, {
                headers: authHeaders(),
            });
            if (!res.ok) return;
            const data = await res.json();
            dispatch({ type: "set_notifications", payload: data });
        } catch (e) {
            console.error("notifications: fetch failed", e);
        }
    }, [dispatch]);

    // ----- mark one as read -----
    const markAsRead = useCallback(
        async (id) => {
            try {
                await fetchWithRetry(`${API}/api/notifications/${id}/read`, {
                    method: "PUT",
                    headers: authHeaders(),
                });
                dispatch({ type: "mark_notification_read", payload: id });
            } catch (e) {
                console.error("notifications: markAsRead failed", e);
            }
        },
        [dispatch]
    );

    // ----- mark all as read -----
    const markAllAsRead = useCallback(async () => {
        try {
            await fetchWithRetry(`${API}/api/notifications/read-all`, {
                method: "PUT",
                headers: authHeaders(),
            });
            dispatch({ type: "mark_all_notifications_read" });
        } catch (e) {
            console.error("notifications: markAllAsRead failed", e);
        }
    }, [dispatch]);

    // ----- delete (after handling accept/deny) -----
    const removeNotification = useCallback(
        async (id) => {
            try {
                await fetchWithRetry(`${API}/api/notifications/${id}`, {
                    method: "DELETE",
                    headers: authHeaders(),
                });
                dispatch({ type: "remove_notification", payload: id });
            } catch (e) {
                console.error("notifications: removeNotification failed", e);
            }
        },
        [dispatch]
    );

    // ----- friend request actions -----
    const acceptFriendRequest = useCallback(async (friendshipId) => {
        const res = await fetchWithRetry(
            `${API}/api/friends/requests/${friendshipId}/accept`,
            { method: "PUT", headers: authHeaders() }
        );
        return handle(res);
    }, []);

    const refuseFriendRequest = useCallback(async (friendshipId) => {
        const res = await fetchWithRetry(
            `${API}/api/friends/requests/${friendshipId}/refuse`,
            { method: "PUT", headers: authHeaders() }
        );
        return handle(res);
    }, []);

    // ----- event invite actions -----
    // Accept = nothing to do server-side (creator already added you to participants).
    // Deny   = leave the event (DELETE my participant entry).
    const leaveEvent = useCallback(async (eventId, myUserId) => {
        const res = await fetchWithRetry(
            `${API}/api/events/${eventId}/participants/${myUserId}`,
            { method: "DELETE", headers: authHeaders() }
        );
        return handle(res);
    }, []);

    // ----- polling -----
    useEffect(() => {
        if (!isLogged) return;
        fetchNotifications();
        pollRef.current = setInterval(fetchNotifications, pollMs);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [isLogged, pollMs, fetchNotifications]);

    return {
        notifications: store.notifications || [],
        unreadCount:   store.unreadNotifsCount || 0,
        fetchNotifications,
        markAsRead,
        markAllAsRead,
        removeNotification,
        acceptFriendRequest,
        refuseFriendRequest,
        leaveEvent,
    };
};

export default useNotifications;
