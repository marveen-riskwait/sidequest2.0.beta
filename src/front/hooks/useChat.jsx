import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "../services/api";

const POLL_INTERVAL = 3000;

/**
 * Hook para gestionar una conversación abierta.
 * - Carga mensajes
 * - Polling cada 3s
 * - sendMessage con UI optimista
 * - markRead al montar
 */
export const useChat = (conversationId) => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const lastIdRef = useRef(0);

  const fetchMessages = useCallback(async () => {
    if (!conversationId) return;
    try {
      const data = await api.get(`/conversations/${conversationId}/messages`);
      setMessages(data);
      if (data.length) lastIdRef.current = data[data.length - 1].id;
    } catch (e) { console.error(e); }
  }, [conversationId]);

  const sendMessage = useCallback(async (content) => {
    if (!content?.trim() || !conversationId) return;
    setSending(true);

    // UI optimista: el mensaje aparece al instante
    const optimistic = {
      id: `tmp-${Date.now()}`,
      conversation_id: conversationId,
      sender_id: JSON.parse(localStorage.getItem("user") || "{}")?.id,
      content,
      is_read: false,
      created_at: new Date().toISOString(),
      _optimistic: true,
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const saved = await api.post(`/conversations/${conversationId}/messages`, { content });
      // reemplazamos el optimista por el real
      setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? saved : m)));
    } catch (e) {
      // marca el optimista como fallido
      setMessages((prev) =>
        prev.map((m) => (m.id === optimistic.id ? { ...m, _failed: true } : m))
      );
      console.error(e);
    } finally {
      setSending(false);
    }
  }, [conversationId]);

  const markRead = useCallback(async () => {
    if (!conversationId) return;
    try { await api.post(`/conversations/${conversationId}/read`); } catch (e) {}
  }, [conversationId]);

  // Carga inicial + polling + markRead al abrir
  useEffect(() => {
    if (!conversationId) return;
    setLoading(true);
    fetchMessages().finally(() => setLoading(false));
    markRead();
    const id = setInterval(fetchMessages, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [conversationId, fetchMessages, markRead]);

  return { messages, loading, sending, sendMessage, refetch: fetchMessages };
};