"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Tenant {
  slug: string;
  name: string;
  status: string;
}

interface PlaygroundSession {
  id: string;
  tenant_slug: string;
  hermes_session_id: string;
  title: string;
  created_by_user_id: string;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
}

function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `hace ${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `hace ${diffD}d`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PlaygroundAdmin() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [sessions, setSessions] = useState<PlaygroundSession[]>([]);
  const [activeSession, setActiveSession] = useState<PlaygroundSession | null>(null);
  const [selectedTenant, setSelectedTenant] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Load tenants (super admin sees ALL tenants, not just membership).
  useEffect(() => {
    fetch("/api/admin/tenants")
      .then((r) => r.json())
      .then((data: { tenants: Tenant[] }) => {
        // Only active tenants are chateable.
        const active = (data.tenants || []).filter((t) => t.status === "active");
        setTenants(active);
        if (active.length > 0 && !selectedTenant) {
          setSelectedTenant(active[0].slug);
        }
      })
      .catch(() => setError("No se pudieron cargar los tenants"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load sessions list.
  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const r = await fetch("/api/admin/playground/sessions");
      if (!r.ok) throw new Error("No se pudieron cargar las sesiones");
      const data = (await r.json()) as { sessions: PlaygroundSession[] };
      setSessions(data.sessions);
    } catch (e) {
      // non-fatal — UI still works without history
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Auto-scroll on new messages.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  function startNewConversation() {
    setActiveSession(null);
    setMessages([]);
    setError(null);
  }

  function selectSession(s: PlaygroundSession) {
    setActiveSession(s);
    setSelectedTenant(s.tenant_slug);
    // We don't have the previous messages locally — start empty. Hermes
    // remembers the conversation via the session_id; when the user sends the
    // next message, the agent will reply in context.
    setMessages([]);
    setError(null);
  }

  async function deleteSession(s: PlaygroundSession) {
    if (!confirm(`¿Borrar la sesión "${s.title}"?`)) return;
    const r = await fetch(`/api/admin/playground/sessions/${s.id}`, {
      method: "DELETE",
    });
    if (r.ok) {
      if (activeSession?.id === s.id) {
        setActiveSession(null);
        setMessages([]);
      }
      await loadSessions();
    }
  }

  async function sendMessage(e?: React.FormEvent) {
    e?.preventDefault();
    const message = input.trim();
    if (!message || sending) return;
    if (!selectedTenant) {
      setError("Elegí un tenant primero");
      return;
    }
    setError(null);
    setSending(true);
    setInput("");

    const userMsg: ChatMessage = {
      role: "user",
      content: message,
      ts: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const r = await fetch("/api/admin/playground/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_slug: selectedTenant,
          message,
          session_id: activeSession?.hermes_session_id ?? null,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || "El agente no respondió");
        setSending(false);
        return;
      }
      const botMsg: ChatMessage = {
        role: "assistant",
        content: data.reply,
        ts: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, botMsg]);

      // If this was a new conversation, refresh sessions so the sidebar shows it.
      if (!activeSession || activeSession.hermes_session_id !== data.session_id) {
        await loadSessions();
        // Highlight the newly created session.
        const newSession = sessions.find(
          (s) => s.hermes_session_id === data.session_id
        );
        if (newSession || data.session_portal_id) {
          // sessions list may be stale; refetch and find
          const r2 = await fetch("/api/admin/playground/sessions");
          if (r2.ok) {
            const d2 = (await r2.json()) as { sessions: PlaygroundSession[] };
            const found = d2.sessions.find(
              (s) => s.id === data.session_portal_id
            );
            if (found) setActiveSession(found);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <div className="border-b px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Playground</h1>
          <p className="text-xs text-muted-foreground">
            Simulá conversaciones con cualquier tenant para probar su bot.
          </p>
        </div>
        <button
          onClick={startNewConversation}
          className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          Nueva conversación
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sessions sidebar */}
        <aside className="w-72 border-r overflow-y-auto bg-muted/20">
          <div className="p-3 border-b bg-background sticky top-0">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Conversaciones recientes
            </h2>
          </div>
          {loadingSessions ? (
            <p className="p-4 text-sm text-muted-foreground">Cargando…</p>
          ) : sessions.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Todavía no tenés conversaciones de prueba.
            </p>
          ) : (
            <ul className="divide-y">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className={`group relative px-3 py-3 cursor-pointer hover:bg-muted/50 transition-colors ${
                    activeSession?.id === s.id ? "bg-muted" : ""
                  }`}
                  onClick={() => selectSession(s)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                      {s.tenant_slug}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {formatRelativeTime(s.updated_at)}
                    </span>
                  </div>
                  <p className="text-sm font-medium truncate pr-6">{s.title}</p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(s);
                    }}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-xs text-muted-foreground hover:text-destructive"
                    title="Borrar conversación"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Chat panel */}
        <main className="flex-1 flex flex-col">
          {/* Tenant selector */}
          <div className="border-b px-4 py-2 flex items-center gap-3 bg-background">
            <label
              htmlFor="tenant-select"
              className="text-xs font-medium text-muted-foreground"
            >
              Tenant:
            </label>
            <select
              id="tenant-select"
              value={selectedTenant}
              onChange={(e) => setSelectedTenant(e.target.value)}
              disabled={sending}
              className="border rounded px-2 py-1 text-sm bg-background"
            >
              {tenants.length === 0 && <option value="">Sin tenants</option>}
              {tenants.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name} ({t.slug})
                </option>
              ))}
            </select>
            {activeSession && (
              <span className="text-xs text-muted-foreground font-mono">
                · sesión: {activeSession.hermes_session_id.slice(-12)}
              </span>
            )}
          </div>

          {error && (
            <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-destructive text-xs">
              {error}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
            {messages.length === 0 && !sending && (
              <div className="h-full flex items-center justify-center">
                <div className="text-center max-w-md">
                  <p className="text-sm text-muted-foreground mb-2">
                    {activeSession
                      ? `Sesión "${activeSession.title}". Mandá el próximo mensaje — el agente recuerda lo conversado.`
                      : "Escribí un mensaje para arrancar una conversación nueva con el agente."}
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    La respuesta puede tardar 10-30 segundos (incluye carga del
                    modelo, RAG y tool-calling).
                  </p>
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${
                  m.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  <div className="text-[10px] opacity-60 mb-1">
                    {m.role === "user" ? "Vos" : "Bot"} ·{" "}
                    {formatTime(new Date(m.ts))}
                  </div>
                  {m.content}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2 text-sm">
                  <div className="text-[10px] opacity-60 mb-1">Bot</div>
                  <span className="inline-flex items-center gap-1">
                    <span className="animate-pulse">●</span>
                    <span className="animate-pulse delay-150">●</span>
                    <span className="animate-pulse delay-300">Pensando…</span>
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={sendMessage}
            className="border-t p-3 flex items-end gap-2 bg-background"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                selectedTenant
                  ? `Escribí tu mensaje a ${tenants.find((t) => t.slug === selectedTenant)?.name ?? "el agente"}…  (Enter para enviar, Shift+Enter para nueva línea)`
                  : "Elegí un tenant primero…"
              }
              disabled={sending || !selectedTenant}
              rows={1}
              className="flex-1 border rounded-md px-3 py-2 text-sm bg-background resize-none disabled:opacity-50 max-h-32 overflow-y-auto"
              style={{ minHeight: "40px" }}
            />
            <button
              type="submit"
              disabled={sending || !input.trim() || !selectedTenant}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {sending ? "Enviando…" : "Enviar"}
            </button>
          </form>
        </main>
      </div>
    </div>
  );
}
