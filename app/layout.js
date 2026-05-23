import './globals.css'

export const metadata = {
  title:       'SF Meta Exporter',
  description: 'Professional Salesforce metadata export, analysis, and automation tooling.',
  icons: {
    icon:             '/favicon.ico',
    shortcut:         '/favicon.ico',
    apple:            '/icon-192.png',
    other: [
      { rel: 'icon', type: 'image/png', sizes: '192x192', url: '/icon-192.png' },
      { rel: 'icon', type: 'image/png', sizes: '512x512', url: '/icon-512.png' },
    ],
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
