
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import {
    FiBell,
    FiCheck,
    FiX,
    FiUserPlus,
    FiCalendar,
    FiCheckCircle,
} from "react-icons/fi";

import { useNotifications } from "../hooks/useNotifications.jsx";

// =====================================================
// STYLES (dark, coherent avec Navbar / EventModal)
// =====================================================
const BELL_CSS = `
.sq-bell-wrapper {
  position: relative;
  display: inline-block;
}

.sq-bell-trigger {
  background: transparent !important;
  border: none !important;
  padding: 0.4rem 0.5rem !important;
  position: relative;
  color: #fff;
  line-height: 0;
}
.sq-bell-trigger:hover { background: rgba(255,255,255,0.05) !important; }
.sq-bell-trigger:focus { box-shadow: none !important; outline: none !important; }

.sq-bell-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 1050;
  background: #161922;
  border: 1px solid #262a36;
  color: #e9ecef;
  border-radius: 14px;
  width: 360px;
  max-width: 92vw;
  max-height: 70vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 32px rgba(0,0,0,0.45);
}

.sq-bell-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #262a36;
}
.sq-bell-header-title {
  font-weight: 700; color: #fff; font-size: 0.95rem;
  display: flex; align-items: center; gap: 0.5rem;
}
.sq-bell-mark-all {
  background: transparent !important;
  border: none !important;
  color: #6366f1 !important;
  font-size: 0.78rem !important;
  padding: 0 !important;
}
.sq-bell-mark-all:hover { color: #818cf8 !important; }
.sq-bell-mark-all:disabled { color: #4a4f63 !important; }

.sq-bell-list {
  overflow-y: auto;
  flex: 1;
  min-height: 60px;
}

.sq-bell-empty {
  text-align: center; color: #6c757d; padding: 1.75rem 1rem;
  font-size: 0.88rem;
}

.sq-bell-item {
  display: flex; gap: 0.65rem; align-items: flex-start;
  padding: 0.7rem 1rem;
  border-bottom: 1px solid #1e2230;
  background: transparent;
  transition: background 0.12s ease;
}
.sq-bell-item:last-child { border-bottom: none; }
.sq-bell-item.unread { background: rgba(99,102,241,0.07); }
.sq-bell-item:hover { background: rgba(255,255,255,0.04); }

.sq-bell-icon {
  width: 36px; height: 36px; flex-shrink: 0;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  color: #fff;
}
.sq-bell-icon.friend { background: linear-gradient(135deg, #6366f1, #4f46e5); }
.sq-bell-icon.event  { background: linear-gradient(135deg, #ec4899, #db2777); }

.sq-bell-body { flex: 1; min-width: 0; cursor: pointer; }
.sq-bell-text {
  color: #e9ecef; font-size: 0.88rem; line-height: 1.3;
  word-break: break-word;
}
.sq-bell-text strong { color: #fff; }
.sq-bell-time {
  color: #6c757d; font-size: 0.72rem; margin-top: 0.2rem;
}
.sq-bell-actions {
  display: flex; gap: 0.4rem; margin-top: 0.5rem; flex-wrap: wrap;
}
.sq-bell-btn {
  border-radius: 8px !important;
  font-size: 0.75rem !important;
  padding: 0.2rem 0.55rem !important;
  display: inline-flex; align-items: center; gap: 0.3rem;
}

.sq-bell-unread-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #6366f1; flex-shrink: 0; margin-top: 6px;
}

@media (max-width: 420px) {
  .sq-bell-panel { width: 92vw; }
}
`;

// =====================================================
// HELPERS
// =====================================================
const formatRelative = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (Number.isNaN(diff)) return "";
    if (diff < 60) return "ahora";
    if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
    if (diff < 604800) return `hace ${Math.floor(diff / 86400)} d`;
    return d.toLocaleDateString();
};

const emailToName = (email = "") => email.split("@")[0] || email;

// =====================================================
// MAIN
// =====================================================
export const NotificationBell = () => {
    const navigate = useNavigate();
    const {
        notifications,
        unreadCount,
        fetchNotifications,
        markAsRead,
        markAllAsRead,
        removeNotification,
        acceptFriendRequest,
        refuseFriendRequest,
        leaveEvent,
    } = useNotifications();

    const [busyId, setBusyId] = useState(null);
    const [open, setOpen]     = useState(false);
    const wrapperRef          = useRef(null);

    // ----- outside click / Escape -----
    useEffect(() => {
        if (!open) return;

        const handlePointer = (e) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        const handleKey = (e) => {
            if (e.key === "Escape") setOpen(false);
        };

        document.addEventListener("mousedown", handlePointer);
        document.addEventListener("touchstart", handlePointer);
        document.addEventListener("keydown", handleKey);
        return () => {
            document.removeEventListener("mousedown", handlePointer);
            document.removeEventListener("touchstart", handlePointer);
            document.removeEventListener("keydown", handleKey);
        };
    }, [open]);

    // refetch when opening
    const toggleOpen = () => {
        setOpen((prev) => {
            const next = !prev;
            if (next) fetchNotifications();
            return next;
        });
    };

    const currentUser = (() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    })();

    // ----- friend request actions -----
    const handleAcceptFriend = async (notif) => {
        const fId = notif.payload?.friendship_id;
        if (!fId) return;
        setBusyId(notif.id);
        try {
            await acceptFriendRequest(fId);
            await removeNotification(notif.id).catch(() => {});
            fetchNotifications();
        } finally {
            setBusyId(null);
        }
    };

    const handleRefuseFriend = async (notif) => {
        const fId = notif.payload?.friendship_id;
        if (!fId) return;
        setBusyId(notif.id);
        try {
            await refuseFriendRequest(fId);
            await removeNotification(notif.id).catch(() => {});
            fetchNotifications();
        } finally {
            setBusyId(null);
        }
    };

    // ----- event invite actions -----
    const handleAcceptEvent = async (notif) => {
        setBusyId(notif.id);
        try {
            await markAsRead(notif.id);
            await removeNotification(notif.id).catch(() => {});
        } finally {
            setBusyId(null);
        }
    };

    const handleDeclineEvent = async (notif) => {
        const eventId = notif.payload?.event_id;
        if (!eventId || !currentUser?.id) return;
        setBusyId(notif.id);
        try {
            await leaveEvent(eventId, currentUser.id);
            await removeNotification(notif.id).catch(() => {});
            fetchNotifications();
        } finally {
            setBusyId(null);
        }
    };

    const handleClickItem = (notif) => {
        if (!notif.is_read) markAsRead(notif.id);
        setOpen(false);
        if (notif.type === "event_invite" && notif.payload?.event_id) {
            navigate("/events");
        } else if (notif.type === "friend_request") {
            navigate("/friends");
        }
    };

    // ----- renderer -----
    const renderItem = (n) => {
        const from   = n.payload?.from_email ? emailToName(n.payload.from_email) : "Alguien";
        const isFriend = n.type === "friend_request";
        const isEvent  = n.type === "event_invite";

        return (
            <div key={n.id} className={`sq-bell-item ${n.is_read ? "" : "unread"}`}>
                <div className={`sq-bell-icon ${isFriend ? "friend" : "event"}`}>
                    {isFriend ? <FiUserPlus size={18} /> : <FiCalendar size={18} />}
                </div>

                <div className="sq-bell-body" onClick={() => handleClickItem(n)} role="button">
                    <div className="sq-bell-text">
                        {isFriend && (
                            <>
                                <strong>{from}</strong> te ha enviado una solicitud de amistad.
                            </>
                        )}
                        {isEvent && (
                            <>
                                <strong>{from}</strong> te ha invitado al evento{" "}
                                <strong>{n.payload?.event_title || "(sin título)"}</strong>
                                {n.payload?.event_date && (
                                    <> el <em>{n.payload.event_date}</em></>
                                )}
                                {n.payload?.event_time && (
                                    <> a las {n.payload.event_time}</>
                                )}
                                .
                            </>
                        )}
                    </div>
                    <div className="sq-bell-time">{formatRelative(n.created_at)}</div>

                    <div className="sq-bell-actions" onClick={(e) => e.stopPropagation()}>
                        {isFriend && (
                            <>
                                <Button
                                    size="sm"
                                    variant="success"
                                    className="sq-bell-btn"
                                    disabled={busyId === n.id}
                                    onClick={() => handleAcceptFriend(n)}
                                >
                                    <FiCheck /> Aceptar
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline-danger"
                                    className="sq-bell-btn"
                                    disabled={busyId === n.id}
                                    onClick={() => handleRefuseFriend(n)}
                                >
                                    <FiX /> Rechazar
                                </Button>
                            </>
                        )}
                        {isEvent && (
                            <>
                                <Button
                                    size="sm"
                                    variant="success"
                                    className="sq-bell-btn"
                                    disabled={busyId === n.id}
                                    onClick={() => handleAcceptEvent(n)}
                                >
                                    <FiCheck /> Aceptar
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline-danger"
                                    className="sq-bell-btn"
                                    disabled={busyId === n.id}
                                    onClick={() => handleDeclineEvent(n)}
                                >
                                    <FiX /> Rechazar
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {!n.is_read && <div className="sq-bell-unread-dot" />}
            </div>
        );
    };

    return (
        <>
            <style>{BELL_CSS}</style>

            <div ref={wrapperRef} className="sq-bell-wrapper">
                <Button
                    variant="dark"
                    className="sq-bell-trigger"
                    onClick={toggleOpen}
                    title="Notificaciones"
                    aria-expanded={open}
                    aria-haspopup="true"
                >
                    <FiBell size={22} color="white" />
                    {unreadCount > 0 && (
                        <Badge
                            bg="danger"
                            pill
                            className="position-absolute top-0 start-100 translate-middle"
                            style={{ fontSize: "0.65rem" }}
                        >
                            {unreadCount > 99 ? "99+" : unreadCount}
                        </Badge>
                    )}
                </Button>

                {open && (
                    <div className="sq-bell-panel" role="menu">
                        <div className="sq-bell-header">
                            <div className="sq-bell-header-title">
                                <FiBell /> Notificaciones
                                {unreadCount > 0 && (
                                    <Badge bg="primary" pill>{unreadCount}</Badge>
                                )}
                            </div>
                            <Button
                                className="sq-bell-mark-all"
                                onClick={markAllAsRead}
                                disabled={unreadCount === 0}
                            >
                                <FiCheckCircle className="me-1" />
                                Marcar todas
                            </Button>
                        </div>

                        <div className="sq-bell-list">
                            {!notifications || notifications.length === 0 ? (
                                <div className="sq-bell-empty">
                                    No tienes notificaciones nuevas.
                                </div>
                            ) : (
                                notifications.map(renderItem)
                            )}
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};

export default NotificationBell;
