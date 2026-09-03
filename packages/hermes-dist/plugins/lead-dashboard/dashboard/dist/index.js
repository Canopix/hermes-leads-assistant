/**
 * Lead Dashboard — Kanban for captured leads (Frío / Tibio / Caliente)
 * Plain IIFE using window.__HERMES_PLUGIN_SDK__
 */
(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) return;

  const { React } = SDK;
  const h = React.createElement;
  const { Card, CardContent, Button, Badge } = SDK.components;
  const { useState, useEffect, useCallback } = SDK.hooks;
  const { cn, timeAgo } = SDK.utils;

  const API = "/api/plugins/lead-dashboard";

  const COLUMNS = [
    {
      id: "frio",
      label: "Frío",
      help: "Contacto inicial — poca señal de compra todavía",
      dot: "lead-kanban-dot-frio",
    },
    {
      id: "tibio",
      label: "Tibio",
      help: "Interés claro — conviene seguir la conversación",
      dot: "lead-kanban-dot-tibio",
    },
    {
      id: "caliente",
      label: "Caliente",
      help: "Alta intención — priorizar contacto",
      dot: "lead-kanban-dot-caliente",
    },
  ];

  const URGENCY_LABELS = {
    low: "baja",
    medium: "media",
    high: "alta",
  };

  function parseApiError(err) {
    const raw = (err && err.message) ? String(err.message) : String(err || "");
    const m = raw.match(/^(\d{3}):\s*(.*)$/s);
    const body = m ? m[2] : raw;
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.detail === "string") return parsed.detail;
    } catch (_e) { /* ignore */ }
    return body || raw;
  }

  function truncate(s, n) {
    if (!s) return "";
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  function looksLikeSessionId(value) {
    if (!value) return false;
    return /^\d{8}_\d{6}_[a-f0-9]{8}$/i.test(value) || /^[0-9a-f-]{20,}$/i.test(value);
  }

  function displayName(lead) {
    const name = (lead.name || "").trim();
    if (name && !looksLikeSessionId(name)) return name;
    if (lead.email) return lead.email.split("@")[0];
    if (lead.phone) return "Lead " + lead.phone.slice(-4);
    const uid = String(lead.user_id || "");
    if (uid && !looksLikeSessionId(uid)) {
      return uid.length > 12 ? "Usuario …" + uid.slice(-6) : uid;
    }
    return "Lead sin nombre";
  }

  function urgencyPill(urgency) {
    const key = (urgency || "medium").toLowerCase();
    const label = URGENCY_LABELS[key] || key;
    return h("span", {
      className: cn("lead-kanban-pill", "lead-kanban-pill--urgency-" + (URGENCY_LABELS[key] ? key : "medium")),
      title: "Urgencia " + label,
    }, label);
  }

  function platformPill(platform) {
    if (!platform) return null;
    return h("span", {
      className: "lead-kanban-pill lead-kanban-pill--platform",
      title: "Plataforma",
    }, platform);
  }

  function contactPill(lead) {
    if (lead.email) return h("span", { className: "lead-kanban-pill lead-kanban-pill--contact", title: lead.email }, "email");
    if (lead.phone) return h("span", { className: "lead-kanban-pill lead-kanban-pill--contact", title: lead.phone }, "tel");
    return null;
  }

  function relativeTime(iso) {
    if (!iso || !timeAgo) return "";
    try {
      return timeAgo(iso);
    } catch (_e) {
      return "";
    }
  }

  function LeadCard(props) {
    const { lead, onSelect, dragging } = props;
    const title = displayName(lead);
    const snippet = lead.last_user_message || lead.summary || "";
    const when = relativeTime(lead.updated_at || lead.created_at);

    return h(
      Card,
      {
        className: cn("lead-kanban-card", dragging && "lead-kanban-card--dragging"),
        draggable: true,
        onDragStart: function (e) {
          e.dataTransfer.setData("text/lead-id", lead.id);
          e.dataTransfer.setData("text/from-column", lead.kanban_column || "tibio");
          e.dataTransfer.effectAllowed = "move";
          if (props.onDragStart) props.onDragStart(lead.id);
        },
        onDragEnd: function () {
          if (props.onDragEnd) props.onDragEnd();
        },
        onClick: function () { onSelect(lead); },
      },
      h(CardContent, { className: "lead-kanban-card-content" },
        h("div", { className: "lead-kanban-card-top" },
          h("div", { className: "lead-kanban-card-title" }, title),
          when ? h("span", { className: "lead-kanban-card-time", title: lead.updated_at || lead.created_at }, when) : null
        ),
        lead.interest
          ? h("div", { className: "lead-kanban-card-interest" }, lead.interest)
          : null,
        snippet
          ? h("div", { className: "lead-kanban-card-message" }, truncate(snippet, 140))
          : null,
        h("div", { className: "lead-kanban-card-footer" },
          urgencyPill(lead.urgency),
          platformPill(lead.platform),
          contactPill(lead)
        )
      )
    );
  }

  function LeadDrawer(props) {
    const { lead, onClose } = props;
    if (!lead) return null;

    const fields = [
      ["Nombre", lead.name],
      ["Email", lead.email],
      ["Teléfono", lead.phone],
      ["Interés", lead.interest],
      ["Urgencia", lead.urgency ? (URGENCY_LABELS[lead.urgency] || lead.urgency) : null],
      ["Temperatura", lead.temperature],
      ["Columna", lead.kanban_column],
      ["Plataforma", lead.platform],
      ["User ID", lead.user_id],
      ["Sesión", lead.session_id],
      ["Creado", lead.created_at],
      ["Actualizado", lead.updated_at],
    ].filter(function (pair) { return !!pair[1]; });

    return h(React.Fragment, null,
      h("div", {
        className: "lead-kanban-drawer-backdrop",
        onClick: onClose,
        role: "presentation",
      }),
      h("aside", {
        className: "lead-kanban-drawer",
        role: "dialog",
        "aria-label": "Detalle del lead",
      },
        h("div", { className: "lead-kanban-drawer-header" },
          h("div", null,
            h("h3", { className: "lead-kanban-drawer-title" }, displayName(lead)),
            lead.interest
              ? h("p", { className: "lead-kanban-drawer-subtitle" }, lead.interest)
              : null
          ),
          h(Button, { variant: "ghost", size: "sm", onClick: onClose }, "Cerrar")
        ),
        h("div", { className: "lead-kanban-drawer-body" },
          lead.summary || lead.last_user_message
            ? h("section", { className: "lead-kanban-section" },
                h("h4", { className: "lead-kanban-section-title" }, "Último mensaje"),
                h("div", { className: "lead-kanban-summary" },
                  lead.last_user_message || lead.summary
                )
              )
            : null,
          fields.length
            ? h("section", { className: "lead-kanban-section" },
                h("h4", { className: "lead-kanban-section-title" }, "Datos"),
                h("dl", { className: "lead-kanban-fields" },
                  fields.map(function (pair) {
                    return [
                      h("dt", { key: pair[0] + "-dt" }, pair[0]),
                      h("dd", { key: pair[0] + "-dd" }, String(pair[1])),
                    ];
                  }).flat()
                )
              )
            : null,
          lead.events && lead.events.length
            ? h("section", { className: "lead-kanban-section" },
                h("h4", { className: "lead-kanban-section-title" }, "Actividad"),
                h("ul", { className: "lead-kanban-events" },
                  lead.events.slice(0, 12).map(function (ev, i) {
                    return h("li", { key: i, className: "lead-kanban-event" },
                      h("strong", null, ev.event_type),
                      " · ",
                      ev.created_at || ""
                    );
                  })
                )
              )
            : null
        )
      )
    );
  }

  function KanbanColumn(props) {
    const { col, cards, dropCol, dragId, onDrop, onDragOver, onDragLeave, onSelect, onDragStart, onDragEnd } = props;
    const isDrop = dropCol === col.id;

    return h(
      "div",
      {
        key: col.id,
        className: cn("lead-kanban-column", isDrop && "lead-kanban-column--drop"),
        onDragOver: function (e) { e.preventDefault(); onDragOver(col.id); },
        onDragLeave: onDragLeave,
        onDrop: function (e) { onDrop(col.id, e); },
      },
      h("div", { className: "lead-kanban-column-header", title: col.help },
        h("span", { className: cn("lead-kanban-dot", col.dot) }),
        h("span", { className: "lead-kanban-column-label" }, col.label),
        h("span", { className: "lead-kanban-column-count" }, String(cards.length))
      ),
      h("div", { className: "lead-kanban-column-sub" }, col.help),
      h("div", { className: "lead-kanban-column-body" },
        cards.length === 0
          ? h("div", { className: "lead-kanban-empty" }, "Sin leads en esta columna")
          : cards.map(function (lead) {
              return h(LeadCard, {
                key: lead.id,
                lead: lead,
                onSelect: onSelect,
                dragging: dragId === lead.id,
                onDragStart: onDragStart,
                onDragEnd: onDragEnd,
              });
            })
      )
    );
  }

  function LeadBoard() {
    const [columns, setColumns] = useState({ frio: [], tibio: [], caliente: [] });
    const [stats, setStats] = useState(null);
    const [kb, setKb] = useState(null);
    const [selected, setSelected] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [dragId, setDragId] = useState(null);
    const [dropCol, setDropCol] = useState(null);
    const [reingesting, setReingesting] = useState(false);

    const load = useCallback(function () {
      setLoading(true);
      setError("");
      Promise.all([
        SDK.fetchJSON(API + "/leads"),
        SDK.fetchJSON(API + "/stats"),
        SDK.fetchJSON(API + "/knowledge/status"),
      ])
        .then(function (results) {
          setColumns(results[0].columns || { frio: [], tibio: [], caliente: [] });
          setStats(results[1]);
          setKb(results[2]);
        })
        .catch(function (err) {
          setError(parseApiError(err));
        })
        .finally(function () { setLoading(false); });
    }, []);

    useEffect(function () { load(); }, [load]);

    const openLead = useCallback(function (lead) {
      SDK.fetchJSON(API + "/leads/" + encodeURIComponent(lead.id))
        .then(setSelected)
        .catch(function (err) { setError(parseApiError(err)); });
    }, []);

    const handleDrop = useCallback(function (columnId, e) {
      e.preventDefault();
      setDropCol(null);
      const leadId = e.dataTransfer.getData("text/lead-id");
      if (!leadId) return;
      const colLeads = columns[columnId] || [];
      const position = colLeads.length ? (colLeads[colLeads.length - 1].position || 0) + 1 : 0;
      SDK.fetchJSON(API + "/leads/" + encodeURIComponent(leadId) + "/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: columnId, position: position }),
      })
        .then(load)
        .catch(function (err) { setError(parseApiError(err)); });
    }, [columns, load]);

    const reingest = useCallback(function () {
      setReingesting(true);
      SDK.fetchJSON(API + "/knowledge/reingest", { method: "POST" })
        .then(function () { load(); })
        .catch(function (err) { setError(parseApiError(err)); })
        .finally(function () { setReingesting(false); });
    }, [load]);

    const totalInBoard = (columns.frio || []).length + (columns.tibio || []).length + (columns.caliente || []).length;

    return h("div", { className: "lead-kanban" },
      h("div", { className: "lead-kanban-toolbar" },
        h("h2", { className: "lead-kanban-title" }, "Leads"),
        h("div", { className: "lead-kanban-stats" },
          h("span", { className: "lead-kanban-stat" },
            "Total ", h("strong", null, String(stats ? stats.total : totalInBoard))
          ),
          h("span", { className: "lead-kanban-stat" },
            "Hoy ", h("strong", null, String(stats ? stats.created_today || 0 : 0))
          ),
          COLUMNS.map(function (col) {
            const n = (columns[col.id] || []).length;
            return h("span", { key: col.id, className: "lead-kanban-stat", title: col.help },
              col.label + " ", h("strong", null, String(n))
            );
          }),
          kb
            ? h("span", {
                className: cn("lead-kanban-stat", "lead-kanban-stat--kb"),
                title: "Chunks indexados en la base de conocimiento",
              },
                "KB ", h("strong", null, String(kb.chunk_count || 0)),
                " · ", (kb.backend || "?")
              )
            : null
        ),
        h("div", { className: "lead-kanban-actions" },
          h(Button, { variant: "outline", size: "sm", onClick: load, disabled: loading }, "Actualizar"),
          h(Button, { variant: "secondary", size: "sm", onClick: reingest, disabled: reingesting },
            reingesting ? "Re-indexando…" : "Re-ingestar KB"
          )
        )
      ),

      error ? h("div", { className: "lead-kanban-msg-err", role: "alert" }, error) : null,

      loading && totalInBoard === 0
        ? h("div", { className: "lead-kanban-loading" },
            h("span", { className: "lead-kanban-spinner", "aria-hidden": "true" }),
            "Cargando leads…"
          )
        : null,

      h("div", { className: "lead-kanban-board" },
        COLUMNS.map(function (col) {
          return h(KanbanColumn, {
            key: col.id,
            col: col,
            cards: columns[col.id] || [],
            dropCol: dropCol,
            dragId: dragId,
            onDrop: handleDrop,
            onDragOver: setDropCol,
            onDragLeave: function () { setDropCol(null); },
            onSelect: openLead,
            onDragStart: setDragId,
            onDragEnd: function () { setDragId(null); },
          });
        })
      ),

      h(LeadDrawer, { lead: selected, onClose: function () { setSelected(null); } })
    );
  }

  if (window.__HERMES_PLUGINS__ && typeof window.__HERMES_PLUGINS__.register === "function") {
    window.__HERMES_PLUGINS__.register("lead-dashboard", LeadBoard);
  }
})();
