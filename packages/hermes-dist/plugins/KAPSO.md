# Kapso WhatsApp (plugin externo)

WhatsApp se integra con el **plugin oficial de Kapso**, no con código en este repo.

- Docs: https://docs.kapso.ai/docs/whatsapp/hermes-agent
- Repo: `gokapso/hermes-agent-plugin`

## Instalación automática

Al correr `provision-client.sh` con `--kapso-api-key` (o env `KAPSO_API_KEY`), el script:

1. Instala `gokapso/hermes-agent-plugin` en el profile
2. Escribe variables `KAPSO_*` en `.env`
3. Habilita `gateway.platforms.kapso` en `config.yaml`
4. Opcionalmente corre `hermes kapso setup --configure-webhook` si pasás `--kapso-funnel-url`

## Instalación manual

```bash
hermes -p acme-leads plugins install gokapso/hermes-agent-plugin --enable
hermes -p acme-leads kapso setup --configure-webhook --funnel-url https://...
hermes -p acme-leads gateway restart
```
