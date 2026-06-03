// Safely parse a JSON string from localStorage. Returns `null` if the
// value is missing, the literal string "undefined" (left behind by code
// that did setItem(key, undefined)), or any other malformed JSON.
// Without this guard, a stored "undefined" crashes the entire app with
// `SyntaxError: "undefined" is not valid JSON` at boot.
const safeParse = (raw) => {
  if (raw === null || raw === undefined || raw === "undefined" || raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
};

// Persisted state value used by the new map-time-filter dropdown in the
// navbar. `null` means "no filter" (show all upcoming events).
const FILTER_STORAGE_KEY = "sq_map_filter_days";

const readStoredFilter = () => {
  try {
    const v = localStorage.getItem(FILTER_STORAGE_KEY);
    if (v === null || v === "null" || v === "") return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
};

const writeStoredFilter = (val) => {
  try {
    if (val === null || val === undefined) localStorage.removeItem(FILTER_STORAGE_KEY);
    else localStorage.setItem(FILTER_STORAGE_KEY, String(val));
  } catch { /* ignore */ }
};

export const initialStore = () => {
  return {
    message: null,
    user: safeParse(localStorage.getItem("user")),
    token: localStorage.getItem("token") || null,
    todos: [
      { id: 1, title: "Make the bed", background: null },
      { id: 2, title: "Do my homework", background: null },
    ],

    chatRooms: [],
    chatUnreadTotal: 0,

    friends: [],
    incomingRequests: [],
    outgoingRequests: [],

    notifications: [],
    unreadNotifsCount: 0,

    // ── Map filter (navbar dropdown) ──────────────────
    // Number of days to look ahead. null = no filter (show all upcoming).
    // Persisted to localStorage so the choice survives reloads.
    mapFilterDays: readStoredFilter(),
  };
};

const sumUnread = (rooms) =>
  (rooms || []).reduce((sum, r) => sum + (r.unread_count || 0), 0);

export default function storeReducer(store, action = {}) {
  switch (action.type) {
    case "set_hello":
      return { ...store, message: action.payload };

    case "add_task": {
      const { id, color } = action.payload;
      return {
        ...store,
        todos: store.todos.map((t) =>
          t.id === id ? { ...t, background: color } : t
        ),
      };
    }

    case "set_user":
      // Never write the literal string "undefined" to storage. Treat
      // null/undefined/falsy as "logout".
      if (action.payload && typeof action.payload === "object") {
        localStorage.setItem("user", JSON.stringify(action.payload));
        return { ...store, user: action.payload };
      }
      localStorage.removeItem("user");
      return { ...store, user: null };

    case "set_chat_rooms": {
      const rooms = action.payload || [];
      return { ...store, chatRooms: rooms, chatUnreadTotal: sumUnread(rooms) };
    }

    case "set_chat_unread_total":
      return { ...store, chatUnreadTotal: action.payload || 0 };

    case "mark_room_read_local": {
      const roomId = action.payload;
      const rooms = (store.chatRooms || []).map((r) =>
        r.id === roomId ? { ...r, unread_count: 0 } : r
      );
      return { ...store, chatRooms: rooms, chatUnreadTotal: sumUnread(rooms) };
    }

    case "upsert_chat_room": {
      const room = action.payload;
      if (!room) return store;
      const idx = (store.chatRooms || []).findIndex((r) => r.id === room.id);
      let next;
      if (idx === -1) next = [room, ...(store.chatRooms || [])];
      else { next = [...store.chatRooms]; next[idx] = room; }
      return { ...store, chatRooms: next, chatUnreadTotal: sumUnread(next) };
    }

    case "logout":
      writeStoredFilter(null);
      return {
        ...store,
        user: null,
        chatRooms: [],
        chatUnreadTotal: 0,
        friends: [],
        incomingRequests: [],
        outgoingRequests: [],
        notifications: [],
        unreadNotifsCount: 0,
        mapFilterDays: null,
      };

    // ── friends ───────────────────────────────────
    case "set_friends":           return { ...store, friends: action.payload };
    case "set_incoming_requests": return { ...store, incomingRequests: action.payload };
    case "set_outgoing_requests": return { ...store, outgoingRequests: action.payload };
    case "remove_friend":         return { ...store, friends: store.friends.filter(f => f.friend?.id !== action.payload) };
    case "remove_incoming_request": return { ...store, incomingRequests: store.incomingRequests.filter(r => r.id !== action.payload) };
    case "remove_outgoing_request": return { ...store, outgoingRequests: store.outgoingRequests.filter(r => r.id !== action.payload) };
    case "add_outgoing_request":  return { ...store, outgoingRequests: [...store.outgoingRequests, action.payload] };
    case "add_friend":            return { ...store, friends: [...store.friends, action.payload] };

    // ── notifications ─────────────────────────────
    case "set_notifications": {
      const list = action.payload || [];
      return { ...store, notifications: list, unreadNotifsCount: list.filter(n => !n.is_read).length };
    }
    case "set_unread_notifs_count":
      return { ...store, unreadNotifsCount: action.payload || 0 };

    case "mark_notification_read": {
      const list = (store.notifications || []).map(n =>
        n.id === action.payload ? { ...n, is_read: true } : n
      );
      return { ...store, notifications: list, unreadNotifsCount: list.filter(n => !n.is_read).length };
    }
    case "mark_all_notifications_read": {
      const list = (store.notifications || []).map(n => ({ ...n, is_read: true }));
      return { ...store, notifications: list, unreadNotifsCount: 0 };
    }
    case "remove_notification": {
      const list = (store.notifications || []).filter(n => n.id !== action.payload);
      return { ...store, notifications: list, unreadNotifsCount: list.filter(n => !n.is_read).length };
    }

    // ── map filter ────────────────────────────────
    // payload: number of days (1, 3, 7, 14, 30, 90) or null to clear.
    case "set_map_filter_days": {
      const v = action.payload === null || action.payload === undefined ? null : Number(action.payload);
      const safe = (typeof v === "number" && Number.isFinite(v) && v > 0) ? v : null;
      writeStoredFilter(safe);
      return { ...store, mapFilterDays: safe };
    }

    default:
      console.warn("Unknown action type:", action.type);
      return store;
  }
}