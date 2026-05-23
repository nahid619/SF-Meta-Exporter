/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Increase the default 4 MB body size limit for the restore route,
   * which POSTs all CSV data as a JSON body. 50 MB covers most sandbox
   * backups; raise further if you back up very large orgs.
   */
  experimental: {
    serverActions: { bodySizeLimit: '50mb' },
  },

  /**
   * allowedDevOrigins — required in Next.js 15 when accessing the dev server
   * from an IP address or hostname other than localhost.
   *
   * Add any origin you use to access the app during development.
   * This has no effect in production builds.
   *
   * Format: hostname only (no protocol, no port, no trailing slash).
   */
  allowedDevOrigins: [
    '192.168.0.33',   // local network IP — change to your machine's IP if different
    '127.0.0.1',
    'localhost',
  ],
}

module.exports = nextConfig
