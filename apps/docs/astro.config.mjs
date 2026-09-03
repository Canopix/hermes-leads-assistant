import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightClientMermaid from "@pasqal-io/starlight-client-mermaid";

export default defineConfig({
  server: {
    host: true,
    port: 4321,
  },
  integrations: [
    starlight({
      title: "Hermes Leads Assistant",
      description: "Project documentation",
      locales: {
        root: {
          label: "English",
          lang: "en",
        },
      },
      plugins: [starlightClientMermaid({})],
      sidebar: [
        {
          label: "Home",
          link: "/",
        },
        {
          label: "Architecture",
          items: [
            { label: "Overview", link: "/architecture/" },
            { label: "Message flow", link: "/architecture/message-flow" },
            { label: "Tenant isolation", link: "/architecture/multi-tenancy" },
          ],
        },
        {
          label: "Hermes plugins",
          items: [
            { label: "Overview", link: "/plugins/" },
            { label: "lead-scope", link: "/plugins/lead-scope" },
            { label: "lead-rag", link: "/plugins/lead-rag" },
            { label: "lead-catalog", link: "/plugins/lead-catalog" },
            { label: "lead-capture", link: "/plugins/lead-capture" },
            { label: "lead-verify", link: "/plugins/lead-verify" },
            { label: "lead-documents", link: "/plugins/lead-documents" },
            { label: "lead-dashboard", link: "/plugins/lead-dashboard" },
          ],
        },
        {
          label: "Web portal",
          items: [
            { label: "Overview", link: "/portal/" },
            { label: "Auth and sessions", link: "/portal/auth" },
            { label: "Multi-tenancy", link: "/portal/multi-tenancy" },
            { label: "API routes", link: "/portal/api-routes" },
            { label: "Data layer", link: "/portal/data-layer" },
          ],
        },
        {
          label: "Operator tooling",
          items: [
            { label: "Overview", link: "/ops/" },
            { label: "leadai CLI", link: "/ops/cli" },
            { label: "Provisioning", link: "/ops/provisioning" },
            { label: "VPS deploy", link: "/ops/deploy" },
            { label: "Langfuse in the portal", link: "/ops/langfuse-portal" },
          ],
        },
        {
          label: "Data model",
          items: [
            { label: "Overview", link: "/data/" },
            { label: "Migrations", link: "/data/migrations" },
            { label: "Contract test", link: "/data/contract-test" },
          ],
        },
        {
          label: "Runbooks",
          items: [
            { label: "Provision a client", link: "/runbooks/provision-a-client" },
            { label: "Deprovision / archive", link: "/runbooks/deprovision" },
            { label: "Debug a bot", link: "/runbooks/debug-a-bot" },
            { label: "Langfuse local", link: "/runbooks/langfuse-local" },
            { label: "Backups and restore", link: "/runbooks/backups" },
          ],
        },
        {
          label: "Design decisions",
          items: [
            { label: "Why SQLite", link: "/adr/sqlite" },
            { label: "Why Hermes profiles", link: "/adr/hermes-profiles" },
            { label: "Why better-sqlite3 + WAL", link: "/adr/wal" },
            { label: "Why schema contracts", link: "/adr/schema-contracts" },
          ],
        },
      ],
      social: {
        github: "https://github.com/canopix/hermes-leads-assistant",
        twitter: "https://x.com/emanuel_build",
      },
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
