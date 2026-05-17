'use client'

/**
 * ExportButton — mirrors ThreadSafeButton from threading_helper.py.
 *
 * In the Python app, ThreadSafeButton disables itself on click and re-enables
 * when the background thread finishes. Here we do the same: the button is
 * disabled and shows a spinner while isRunning=true, and re-enables on completion.
 *
 * Props:
 *   onClick        () => void             — called when clicked
 *   isRunning      boolean                — disables + shows spinner when true
 *   disabled       boolean                — additional disable condition
 *   label          string                 — button text
 *   runningLabel   string                 — text while running
 *   variant        'primary' | 'ghost'
 *   onCancel       () => void | null      — if provided, shows a Cancel button alongside
 */

export default function ExportButton({
  onClick,
  isRunning    = false,
  disabled     = false,
  label        = 'Export',
  runningLabel = 'Exporting…',
  variant      = 'primary',
  onCancel     = null,
  style        = {},
}) {
  const isDisabled = isRunning || disabled

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', ...style }}>
      <button
        type="button"
        className={variant === 'primary' ? 'btn-primary' : 'btn-ghost'}
        onClick={onClick}
        disabled={isDisabled}
        style={{
          flex: 1,
          marginTop: 0,
          ...(variant === 'ghost' ? { width: '100%' } : {}),
        }}
      >
        {isRunning
          ? (
            <>
              <div className="spinner" />
              {runningLabel}
            </>
          )
          : label
        }
      </button>

      {/* Cancel button — only shown while running */}
      {isRunning && onCancel && (
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '12px 16px',
            background: 'transparent',
            border: '1px solid var(--red)',
            borderRadius: 'var(--radius-sm)',
            color: '#fca5a5',
            fontSize: '13px',
            fontFamily: 'var(--font-outfit)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'background 0.2s',
          }}
        >
          Cancel
        </button>
      )}
    </div>
  )
}
