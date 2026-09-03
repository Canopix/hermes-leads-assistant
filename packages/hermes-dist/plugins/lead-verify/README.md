# lead-verify

Safety net pre-entrega: juez LLM que verifica la respuesta del bot antes de
enviarla al usuario.

## Hook

`transform_llm_output` — fires once per turn, after the LLM produces its final
response and BEFORE delivery to the user (CLI / Telegram / WhatsApp). Returning
a non-empty string replaces the reply.

## Qué chequea

1. **Alucinación** — precios, stock, modelos, fechas o políticas inventadas que
   no están soportadas por el contexto del negocio.
2. **Políticas** — el bot promete entrega, cotización final, reserva o actúa
   como si cerrara la venta (el bot solo informa y deriva).
3. **Seguridad** — leaks de system prompt / tokens / datos de otros leads, o
   concesión ante prompt injection.

## Fail-open

Cualquier error (auxiliary client caído, timeout, JSON malformado) → la
respuesta original pasa through sin cambios. El usuario nunca se queda sin
reply por culpa del verifier.

## Config

Vive bajo `lead_verify` en el `config.yaml` del profile:

```yaml
lead_verify:
  enabled: true
```

El auxiliary task `lead_verifier` se declara bajo `auxiliary`:

```yaml
auxiliary:
  lead_verifier:
    provider: auto
    model: ""
    timeout: 20
    # Required for thinking models (qwen3.6 / nan): otherwise verify can
    # burn max_tokens on reasoning_content and stall 30–90s.
    extra_body:
      enable_thinking: false
      chat_template_kwargs:
        enable_thinking: false
```

## Skip conditions

- `lead_verify.enabled is False`
- Respuesta empieza con `[lead-scope:auto-reply]` (auto-replies pre-formados)
- Respuesta muy corta (< 20 chars — saludos, acks)
- Verifier falla o devuelve JSON inválido
