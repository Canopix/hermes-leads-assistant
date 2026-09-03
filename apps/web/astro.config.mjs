import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

export default defineConfig({
  site: "https://hermesleads.com",
  server: {
    host: true,
    port: 4322,
  },
  integrations: [tailwind()],
});
