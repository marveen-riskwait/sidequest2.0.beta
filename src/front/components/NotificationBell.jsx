// src/front/components/NotificationBell.jsx
import { useNavigate } from "react-router-dom";
import Dropdown from "react-bootstrap/Dropdown";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import {
    FiBell,
    FiUser,
    FiCalendar,
    FiUserPlus,
    FiCheck,
    FiX,
    FiHelpCircle,
    FiCheckCircle,
} from "react-icons/fi";

import { useNotifications } from "../hooks/useNotifications.jsx";

const API_URL = import.meta.env.VITE_BACKEND_URL;

const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const fetchWithRetry = async (url, opts = {}) => {
    let delay = 400;
    for (;;) {
        try { return await fetch(url, opts); }
        catch (_) {
            await new Promise((r) => setTimeout(r, delay));
            delay = Math.min(delay * 2, 4000);
        }
    }
};

// =====================================================
// STYLES (dark, coherent avec Navbar / EventModal)
// =====================================================
const BELL_CSS = `
.sq-bell-toggle.dropdown-toggle::after { display: none; }
.sq-bell-toggle {
  background: transparent !important; border: none !important;
  color: #fff !important; padding: 0.25rem 0.5rem;
  position: relative;
}
.sq-bell-toggle:focus { box-shadow: none !important; }

.sq-bell-menu {
  background: #161922; border: 1px solid #262a36;
  color: #e9ecef;
  width: 360px; max-height: 480px;
  overflow-y: auto;
  padding: 0;
}
.sq-bell-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.7rem 0.9rem;
  border-bottom: 1px solid #262a36;
  position: sticky; top: 0; background: #161922; z-index: 2;
}
.sq-bell-title { font-weight: 700; color: #fff; font-size: 0.95rem; }
.sq-bell-mark-all {
  background: transparent !important; border: 1px solid #262a36 !important;
  color: #adb5bd !important; font-size: 0.7rem !important;
  padding: 0.2rem 0.55rem !important;
}
.sq-bell-mark-all:hover { color: #fff !important; border-color: #6366f1 !important; }

.sq-bell-empty {
  color: #6c757d; font-style: italic; font-size: 0.9rem;
  text-align: center; padding: 2rem 1rem;
}

.sq-bell-item {
  display: flex; gap: 0.6rem;
  padding: 0.65rem 0.85rem;
  border-bottom: 1px solid #262a36;
  cursor: pointer;
  transition: background 0.12s ease;
  position: relative;
}
.sq-bell-item:hover { background: #1e2230; }
.sq-bell-item.unread { background: rgba(99,102,241,0.06); }
.sq-bell-item.unread::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0;
  width: 3px; background: #6366f1;
}

.sq-bell-avatar {
  width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid #262a36;
}
.sq-bell-avatar.friend     { background: linear-gradient(135deg, #ec4899, #f97316); color: #fff; }
.sq-bell-avatar.event      { background: linear-gradient(135deg, #6366f1, #ec4899); color: #fff; }
.sq-bell-avatar.suggestion { background: linear-gradient(135deg, #facc15, #f97316); color: #fff; }

.sq-bell-body { flex: 1; min-width: 0; }
.sq-bell-row1 {
  display: flex; justify-content: space-between; align-items: baseline;
  gap: 0.5rem;
}
.sq-bell-msg {
  font-size: 0.86rem; color: #e9ecef; line-height: 1.3;
  white-space: normal; word-break: break-word;
}
.sq-bell-msg strong { color: #fff; }
.sq-bell-time {
  font-size: 0.68rem; color: #6c757d; flex-shrink: 0;
}
.sq-bell-actions {
  display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.5rem;
}
.sq-bell-btn {
  background: #1e2230 !important; color: #adb5bd !important;
  border: 1px solid #262a36 !important;
  font-size: 0.72rem !important;
  padding: 0.18rem 0.55rem !important;
  display: inline-flex !important; align-items: center; gap: 0.25rem;
}
.sq-bell-btn.going  { color: #22d3ee !important; }
.sq-bell-btn.going:hover  { background: rgba(34,211,238,0.15) !important; color: #fff !important; border-color: #22d3ee !important; }
.sq-bell-btn.maybe  { color: #facc15 !important; }
.sq-bell-btn.maybe:hover  { background: rgba(250,204,21,0.15) !important; color: #fff !important; border-color: #facc15 !important; }
.sq-bell-btn.refuse { color: #ff8a8a !important; }
.sq-bell-btn.refuse:hover { background: #7f1d1d !important; color: #fff !important; border-color: #ef4444 !important; }
.sq-bell-btn.accept { color: #4ade80 !important; }
.sq-bell-btn.accept:hover { background: #14532d !important; color: #fff !important; border-color: #22c55e !important; }
.sq-bell-btn.plain:hover  { background: #262a36 !important; color: #fff !important; }

.sq-bell-close {
  background: transparent !important; border: none !important;
  color: #6c757d !important; padding: 0.1rem 0.3rem !important;
  font-size: 0.85rem;
  margin-left: auto;
}
.sq-bell-close:hover { color: #ff8a8a !important; }
`;

// =====================================================
// HELPERS
// =====================================================
const renderMessage = (n) => {
    const p = n.payload || {};
    const from = p.from_email || "Someone";

    if (n.type === "friend_request") {
        return (<><strong>{from}</strong> sent you a friend request</>);
    }

    if (n.type === "event_invite") {
        const title = p.event_title || "an event";
        const when = [p.event_date, p.event_time].filter(Boolean).join(" ");
        return (
            <>
                <strong>{from}</strong> invited you to "<strong>{title}</strong>"
                {when ? ` on ${when}` : ""}
            </>
        );
    }

    if (n.type === "event_public") {
        const title = p.event_title || "a public event";
        const when = [p.event_date, p.event_time].filter(Boolean).join(" ");
        return (
            <>
                <strong>{from}</strong> created a public event "<strong>{title}</strong>"
                {when ? ` on ${when}` : ""}
            </>
        );
    }

    if (n.type === "invite_suggestion") {
        const title = p.event_title || "your event";
        const target = p.suggested_user_email || "someone";
        return (
            <>
                <strong>{from}</strong> suggests inviting <strong>{target}</strong>{" "}
                to "<strong>{title}</strong>"
            </>
        );
    }

    return "You have a new notification";
};

const formatTimeAgo = (iso) => {
    if (!iso) return "";
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return "";
    const diff = Math.max(0, (Date.now() - t) / 1000);
    if (diff < 60) return "now";
    if (diff < 3600) return `${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
    return `${Math.floor(diff / 86400)} d`;
};

// =====================================================
// COMPONENT
// =====================================================
export const NotificationBell = () => {
    const navigate = useNavigate();
    const {
        notifications,
        unreadCount,
        markAsRead,
        markAllRead,
        deleteNotification,
        fetchNotifications,
    } = useNotifications({ poll: true });

    // ----- friend_request -----
    const acceptFriend = async (n) => {
        const fid = (n.payload || {}).friendship_id;
        if (!fid) return;
        const res = await fetchWithRetry(
            `${API_URL}/api/friends/requests/${fid}/accept`,
            { method: "PUT", headers: authHeaders() }
        );
        if (res.ok) { deleteNotification(n.id); fetchNotifications(); }
    };

    const refuseFriend = async (n) => {
        const fid = (n.payload || {}).friendship_id;
        if (!fid) return;
        const res = await fetchWithRetry(
            `${API_URL}/api/friends/requests/${fid}/refuse`,
            { method: "PUT", headers: authHeaders() }
        );
        if (res.ok) { deleteNotification(n.id); fetchNotifications(); }
    };

    // ----- event_invite (3 buttons via /respond) -----
    const respondEvent = async (n, response) => {
        const eid = (n.payload || {}).event_id;
        if (!eid) return;
        const res = await fetchWithRetry(
            `${API_URL}/api/events/${eid}/respond`,
            {
                method: "PUT",
                headers: authHeaders(),
                body: JSON.stringify({ response }),
            }
        );
        if (res.ok) { deleteNotification(n.id); fetchNotifications(); }
    };

    // ----- invite_suggestion (creator-only actions) -----
    const approveSuggestion = async (n) => {
        const p = n.payload || {};
        if (!p.event_id || !p.suggestion_id) return;
        const res = await fetchWithRetry(
            `${API_URL}/api/events/${p.event_id}/suggestions/${p.suggestion_id}/approve`,
            { method: "PUT", headers: authHeaders() }
        );
        if (res.ok) { deleteNotification(n.id); fetchNotifications(); }
    };

    const refuseSuggestion = async (n) => {
        const p = n.payload || {};
        if (!p.event_id || !p.suggestion_id) return;
        const res = await fetchWithRetry(
            `${API_URL}/api/events/${p.event_id}/suggestions/${p.suggestion_id}/refuse`,
            { method: "PUT", headers: authHeaders() }
        );
        if (res.ok) { deleteNotification(n.id); fetchNotifications(); }
    };

    const handleClickNotif = (n) => {
        if (!n.is_read) markAsRead(n.id);
        if (n.type === "event_invite" || n.type === "event_public" || n.type === "invite_suggestion") navigate("/events");
        else if (n.type === "friend_request") navigate("/friends");
    };

    const avatarKindFor = (n) => {
        if (n.type === "friend_request") return "friend";
        if (n.type === "invite_suggestion") return "suggestion";
        return "event";
    };

    const iconFor = (n) => {
        if (n.type === "friend_request") return <FiUser size={18} />;
        if (n.type === "invite_suggestion") return <FiUserPlus size={18} />;
        return <FiCalendar size={18} />;
    };

    return (
        <>
            <style>{BELL_CSS}</style>

            <Dropdown align="end">
                <Dropdown.Toggle
                    as={Button}
                    className="sq-bell-toggle border-0"
                    title="Notifications"
                >
                    <FiBell size={22} />
                    {unreadCount > 0 && (
                        <Badge
                            bg="danger" pill
                            className="position-absolute top-0 start-100 translate-middle"
                            style={{ fontSize: "0.6rem" }}
                        >
                            {unreadCount > 99 ? "99+" : unreadCount}
                        </Badge>
                    )}
                </Dropdown.Toggle>

                <Dropdown.Menu className="sq-bell-menu">
                    <div className="sq-bell-header">
                        <div className="sq-bell-title">Your notifications</div>
                        {unreadCount > 0 && (
                            <Button
                                size="sm"
                                className="sq-bell-mark-all"
                                onClick={(e) => { e.stopPropagation(); markAllRead(); }}
                            >
                                Mark all
                            </Button>
                        )}
                    </div>

                    {(notifications || []).length === 0 ? (
                        <div className="sq-bell-empty">You have no notifications</div>
                    ) : (
                        (notifications || []).slice(0, 5).map((n) => {
                            const isFriend     = n.type === "friend_request";
                            const isEvent      = n.type === "event_invite" || n.type === "event_public";
                            const isSuggestion = n.type === "invite_suggestion";

                            return (
                                <div
                                    key={n.id}
                                    className={`sq-bell-item ${n.is_read ? "" : "unread"}`}
                                    onClick={() => handleClickNotif(n)}
                                >
                                    <div className={`sq-bell-avatar ${avatarKindFor(n)}`}>
                                        {iconFor(n)}
                                    </div>

                                    <div className="sq-bell-body">
                                        <div className="sq-bell-row1">
                                            <div className="sq-bell-msg">{renderMessage(n)}</div>
                                            <div className="sq-bell-time">{formatTimeAgo(n.created_at)}</div>
                                        </div>

                                        <div className="sq-bell-actions">
                                            {isFriend && (
                                                <>
                                                    <Button size="sm" className="sq-bell-btn accept"
                                                        onClick={(e) => { e.stopPropagation(); acceptFriend(n); }}>
                                                        <FiCheck /> Accept
                                                    </Button>
                                                    <Button size="sm" className="sq-bell-btn refuse"
                                                        onClick={(e) => { e.stopPropagation(); refuseFriend(n); }}>
                                                        <FiX /> Refuse
                                                    </Button>
                                                </>
                                            )}

                                            {isEvent && (
                                                <>
                                                    <Button size="sm" className="sq-bell-btn going"
                                                        onClick={(e) => { e.stopPropagation(); respondEvent(n, "going"); }}
                                                        title="Going">
                                                        <FiCheckCircle /> Going
                                                    </Button>
                                                    <Button size="sm" className="sq-bell-btn maybe"
                                                        onClick={(e) => { e.stopPropagation(); respondEvent(n, "maybe"); }}
                                                        title="Maybe">
                                                        <FiHelpCircle /> Maybe
                                                    </Button>
                                                    <Button size="sm" className="sq-bell-btn refuse"
                                                        onClick={(e) => { e.stopPropagation(); respondEvent(n, "not_going"); }}
                                                        title="Not going">
                                                        <FiX /> Not going
                                                    </Button>
                                                </>
                                            )}

                                            {isSuggestion && (
                                                <>
                                                    <Button size="sm" className="sq-bell-btn accept"
                                                        onClick={(e) => { e.stopPropagation(); approveSuggestion(n); }}>
                                                        <FiCheck /> Approve
                                                    </Button>
                                                    <Button size="sm" className="sq-bell-btn refuse"
                                                        onClick={(e) => { e.stopPropagation(); refuseSuggestion(n); }}>
                                                        <FiX /> Refuse
                                                    </Button>
                                                </>
                                            )}

                                            {!n.is_read && (
                                                <Button size="sm" className="sq-bell-btn plain"
                                                    title="Mark as read"
                                                    onClick={(e) => { e.stopPropagation(); markAsRead(n.id); }}>
                                                    <FiCheckCircle />
                                                </Button>
                                            )}
                                            <Button size="sm" className="sq-bell-close" title="Delete"
                                                onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}>
                                                <FiX />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </Dropdown.Menu>
            </Dropdown>
        </>
    );
};