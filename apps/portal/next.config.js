/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@lead-ai/shared"],
  // Produces .next/standalone — a self-contained server.js that reads
  // .next/static and public/ from disk. Used by deploy.sh's systemd unit.
  output: "standalone",
  // Trusted via Better Auth in production; the portal is the only app on
  // this host. Adjust if you run other services on the same origin.
  poweredByHeader: false,
};

module.exports = nextConfig;
