'use client'

/**
 * ProgressBar — shows export progress.
 * Receives { percent, eta, message } from the useExport hook's `progress` state.
 * Mirrors the progress display in the Python app's GUI (progress bar + ETA label).
 */

export default function ProgressBar({ progress, isRunning }) {
  if (!isRunning && !progress) return null

  const percent = progress?.percent ?? 0
  const eta     = progress?.eta     ?? ''
  const message = progress?.message ?? ''

  const isDone = !isRunning && percent === 100

  return (
    <div style={{ marginTop: '16px' }}>
      {/* Track */}
      <div style={{
        height: '6px',
        background: 'var(--bg-input)',
        borderRadius: '3px',
        overflow: 'hidden',
        border: '1px solid var(--border-hi)',
      }}>
        {/* Fill */}
        <div style={{
          height: '100%',
          width: `${Math.min(percent, 100)}%`,
          backgroundColor: isDone ? 'var(--green)' : 'var(--accent)',
          borderRadius: '3px',
          transition: 'width 0.4s ease, background-color 0.3s',
          backgroundImage: isRunning && percent < 100
            ? 'linear-gradient(45deg, rgba(255,255,255,0.08) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.08) 75%, transparent 75%)'
            : 'none',
          backgroundSize: '24px 24px',
          animation: isRunning && percent < 100 ? 'stripe-move 1s linear infinite' : 'none',
        }} />
      </div>

      {/* Labels row */}
      <div style={{
        marginTop: '7px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '12px',
        fontFamily: 'var(--font-mono)',
      }}>
        <span style={{ color: 'var(--text-2)', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {message || (isDone ? '✓ Complete' : isRunning ? 'Processing…' : '')}
        </span>
        <span style={{ color: isDone ? 'var(--green)' : 'var(--text-3)', flexShrink: 0, marginLeft: '8px' }}>
          {isDone ? '100%' : `${Math.round(percent)}%`}
          {eta && !isDone && ` · ETA ${eta}`}
        </span>
      </div>

      {/* Stripe animation keyframes injected once */}
      <style>{`
        @keyframes stripe-move {
          from { background-position: 0 0; }
          to   { background-position: 24px 0; }
        }
      `}</style>
    </div>
  )
}