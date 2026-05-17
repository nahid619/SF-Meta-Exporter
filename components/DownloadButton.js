'use client'

/**
 * DownloadButton — appears after an export completes.
 * Triggers a file download from the provided URL.
 *
 * Props:
 *   url      string    — e.g. '/api/picklist/download/job_abc123'
 *   label    string    — button label
 *   filename string    — hint only; actual filename set by Content-Disposition
 */

export default function DownloadButton({ url, label = 'Download File', filename }) {
  if (!url) return null

  async function handleDownload() {
    try {
      const res = await fetch(url)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || `Download failed: HTTP ${res.status}`)
        return
      }

      // Derive filename: prefer explicit prop, then Content-Disposition header, then fallback
      let name = filename
      if (!name) {
        const cd = res.headers.get('Content-Disposition') || ''
        const match = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i)
        name = match ? decodeURIComponent(match[1]) : 'export'
      }

      const blob    = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a       = document.createElement('a')
      a.href        = blobUrl
      a.download    = name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // Small delay so the browser starts the download before the URL is revoked
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000)
    } catch (err) {
      alert(`Download error: ${err.message}`)
    }
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        width: '100%',
        marginTop: '12px',
        padding: '12px',
        background: 'var(--green-dim)',
        border: '1px solid var(--green)',
        borderRadius: 'var(--radius-sm)',
        color: '#6ee7b7',
        fontSize: '14px',
        fontWeight: 500,
        fontFamily: 'var(--font-outfit)',
        cursor: 'pointer',
        transition: 'background 0.2s',
      }}
    >
      {/* Download icon */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      {label}
    </button>
  )
}