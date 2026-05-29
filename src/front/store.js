export const initialStore = () => {
  return {
    message: null,
    user: null,
    todos: [
      { id: 1, title: "Make the bed", background: null },
      { id: 2, title: "Do my homework", background: null },
    ],

    // ── Chat (navbar) ──────────────────────────────
    chatRooms: [],

    // ── Friends ────────────────────────────────────
    friends: [],
    incomingRequests: [],
    outgoingRequests: [],
  };
};

export default function storeReducer(store, action = {}) {
  switch (action.type) {
    // ── existing ──────────────────────────────────
    case "set_hello":
      return { ...store, message: action.payload };

    case "add_task": {
      const { id, color } = action.payload;
      return {
        ...store,
        todos: store.todos.map((todo) =>
          todo.id === id ? { ...todo, background: color } : todo
        ),
      };
    }

    // ── auth / navbar ─────────────────────────────
    case "set_user":
      return { ...store, user: action.payload };

    case "set_chat_rooms":
      return { ...store, chatRooms: action.payload };

    case "logout":
      return {
        ...store,
        user: null,
        chatRooms: [],
        friends: [],
        incomingRequests: [],
        outgoingRequests: [],
      };

    // ── friends ───────────────────────────────────
    case "set_friends":
      return { ...store, friends: action.payload };

    case "set_incoming_requests":
      return { ...store, incomingRequests: action.payload };

    case "set_outgoing_requests":
      return { ...store, outgoingRequests: action.payload };

    case "remove_friend":
      return {
        ...store,
        friends: store.friends.filter(
          (f) => f.friend?.id !== action.payload
        ),
      };

    case "remove_incoming_request":
      return {
        ...store,
        incomingRequests: store.incomingRequests.filter(
          (r) => r.id !== action.payload
        ),
      };

    case "remove_outgoing_request":
      return {
        ...store,
        outgoingRequests: store.outgoingRequests.filter(
          (r) => r.id !== action.payload
        ),
      };

    case "add_outgoing_request":
      return {
        ...store,
        outgoingRequests: [...store.outgoingRequests, action.payload],
      };

    case "add_friend":
      return { ...store, friends: [...store.friends, action.payload] };

    // ── fallback : ne pas crasher ─────────────────
    default:
      console.warn("Unknown action type:", action.type);
      return store;
  }
}