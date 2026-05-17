/** @type {import('next').NextConfig} */
const nextConfig = {
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
