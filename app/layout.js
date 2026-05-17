import './globals.css'

export const metadata = {
  title:       'SF Meta Exporter',
  description: 'Professional Salesforce metadata export, analysis, and automation tooling.',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
