import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Container, Row, Col, Card, Button, Form, Spinner, InputGroup
} from "react-bootstrap";
import useGlobalReducer from "../hooks/useGlobalReducer.jsx";
import { useChat } from "../hooks/useChat.jsx";
import { api } from "../services/api";
import "./messages.css";

const Messages = () => {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { store } = useGlobalReducer();

  const [conversations, setConversations] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [text, setText] = useState("");

  const currentUserId = store.user?.id;
  const selectedId = conversationId ? parseInt(conversationId) : null;
  const selected = conversations.find((c) => c.id === selectedId);

  const { messages, loading, sending, sendMessage } = useChat(selectedId);

  // Cargar lista de conversaciones + polling cada 5s
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await api.get("/conversations");
        if (alive) setConversations(data);
      } catch (e) { console.error(e); }
      finally { if (alive) setLoadingList(false); }
    };
    load();
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    await sendMessage(text);
    setText("");
  };

  return (
    <Container fluid className="messages-page p-3" style={{ paddingTop: "90px" }}>
      <Row className="g-3" style={{ height: "calc(100vh - 110px)" }}>
        {/* LISTA */}
        <Col md={4}>
          <Card className="h-100 chat-list-card">
            <Card.Header className="chat-header">Tus Conversaciones</Card.Header>
            <Card.Body className="p-0 overflow-auto">
              {loadingList ? (
                <div className="text-center p-4"><Spinner size="sm" /></div>
              ) : conversations.length === 0 ? (
                <div className="text-center p-4 text-muted">
                  No tienes conversaciones todavía.
                </div>
              ) : (
                conversations.map((conv) => {
                  const isActive = conv.id === selectedId;
                  const other = conv.other_user;
                  const name = other?.username || other?.email || `User #${conv.other_user_id}`;
                  const lastMsg = conv.last_message;
                  return (
                    <div
                      key={conv.id}
                      className={`chat-item ${isActive ? "active" : ""}`}
                      onClick={() => navigate(`/messages/${conv.id}`)}
                    >
                      <div className="chat-avatar">
                        {other?.profile_picture_url ? (
                          <img src={other.profile_picture_url} alt={name} />
                        ) : (
                          <div className="chat-avatar-placeholder">
                            {name.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="chat-info">
                        <div className="d-flex justify-content-between">
                          <strong>{name}</strong>
                          {conv.unread_count > 0 && (
                            <span className="chat-unread-badge">{conv.unread_count}</span>
                          )}
                        </div>
                        <small className="text-truncate text-muted d-block">
                          {lastMsg ? lastMsg.content : "Sin mensajes aún"}
                        </small>
                      </div>
                    </div>
                  );
                })
              )}
            </Card.Body>
          </Card>
        </Col>

        {/* CHAT */}
        <Col md={8}>
          {selected ? (
            <Card className="h-100 d-flex flex-column chat-window">
              <Card.Header className="chat-header d-flex align-items-center gap-2">
                {selected.other_user?.profile_picture_url ? (
                  <img
                    src={selected.other_user.profile_picture_url}
                    alt=""
                    className="chat-header-avatar"
                  />
                ) : (
                  <div className="chat-avatar-placeholder small">
                    {(selected.other_user?.username || selected.other_user?.email || "?")
                      .charAt(0).toUpperCase()}
                  </div>
                )}
                <span>
                  {selected.other_user?.username ||
                    selected.other_user?.email ||
                    `User #${selected.other_user_id}`}
                </span>
              </Card.Header>

              <div className="chat-body flex-grow-1">
                {loading && messages.length === 0 ? (
                  <div className="text-center pt-4"><Spinner size="sm" variant="light" /></div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-muted pt-4">
                    Empieza la conversación 👋
                  </div>
                ) : (
                  messages.map((m) => {
                    const mine = m.sender_id === currentUserId;
                    return (
                      <div key={m.id} className={`chat-bubble-row ${mine ? "mine" : "theirs"}`}>
                        <div className={`chat-bubble ${m._failed ? "failed" : ""} ${m._optimistic ? "pending" : ""}`}>
                          <div>{m.content}</div>
                          <small className="chat-time">
                            {new Date(m.created_at).toLocaleTimeString([], {
                              hour: "2-digit", minute: "2-digit",
                            })}
                            {m._optimistic && " · enviando…"}
                            {m._failed && " · ❌ falló"}
                          </small>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <Card.Footer className="chat-footer">
                <Form onSubmit={handleSubmit}>
                  <InputGroup>
                    <Form.Control
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Escribe un mensaje…"
                      autoFocus
                      disabled={sending}
                    />
                    <Button type="submit" variant="success" disabled={sending || !text.trim()}>
                      {sending ? <Spinner size="sm" /> : "Enviar"}
                    </Button>
                  </InputGroup>
                </Form>
              </Card.Footer>
            </Card>
          ) : (
            <Card className="h-100 d-flex justify-content-center align-items-center text-muted">
              Selecciona una conversación para empezar
            </Card>
          )}
        </Col>
      </Row>
    </Container>
  );
};

export default Messages;