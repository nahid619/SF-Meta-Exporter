'use client'

export default function ToggleSwitch({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        width:           '38px',
        height:          '22px',
        borderRadius:    '11px',
        background:      checked ? 'var(--green)' : 'var(--bg-input)',
        border:          `2px solid ${checked ? 'var(--green)' : 'var(--border-hi)'}`,
        cursor:          disabled ? 'not-allowed' : 'pointer',
        position:        'relative',
        transition:      'background 0.2s, border-color 0.2s',
        outline:         'none',
        flexShrink:      0,
        opacity:         disabled ? 0.45 : 1,
        display:         'inline-flex',
        alignItems:      'center',
      }}
    >
      <div style={{
        position:     'absolute',
        top:          '2px',
        left:         checked ? '18px' : '2px',
        width:        '14px',
        height:       '14px',
        borderRadius: '50%',
        background:   '#fff',
        transition:   'left 0.18s',
        boxShadow:    '0 1px 3px rgba(0,0,0,0.35)',
      }} />
    </button>
  )
}
