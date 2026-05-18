'use client'

import { useState, useEffect } from 'react'

// ─── Copy-to-clipboard button ─────────────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      onClick={handleCopy}
      style={{
        padding: '3px 10px',
        fontSize: '11px',
        background: copied ? 'var(--green-dim)' : 'var(--bg-card)',
        border: `1px solid ${copied ? 'var(--green)' : 'var(--border-hi)'}`,
        borderRadius: 'var(--radius-sm)',
        color: copied ? '#6ee7b7' : 'var(--text-3)',
        cursor: 'pointer',
        fontFamily: 'var(--font-outfit)',
        transition: 'all 0.15s',
        flexShrink: 0,
      }}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

// ─── Single callback URL row ──────────────────────────────────────────────────
function CallbackRow({ value, label, labelColor }) {
  return (
    <div style={{ marginBottom: '8px' }}>
      {label && (
        <div style={{ fontSize: '10px', color: labelColor || 'var(--text-3)', marginBottom: '4px', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 600 }}>
          {label}
        </div>
      )}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '9px 12px',
        background: 'var(--bg-page)',
        border: '1px solid var(--border-hi)',
        borderRadius: 'var(--radius-sm)',
      }}>
        <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#6ee7b7', wordBreak: 'break-all' }}>
          {value}
        </code>
        <CopyButton text={value} />
      </div>
    </div>
  )
}

// ─── Step card ────────────────────────────────────────────────────────────────
function Step({ number, title, children }) {
  const [open, setOpen] = useState(number === 1)

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      marginBottom: '8px',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '12px',
          padding: '13px 16px',
          background: open ? 'var(--accent-dim)' : 'var(--bg-card-alt)',
          border: 'none', cursor: 'pointer', textAlign: 'left',
          borderBottom: open ? '1px solid var(--border)' : 'none',
          transition: 'background 0.15s',
        }}
      >
        <div style={{
          width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
          background: open ? 'var(--accent)' : 'var(--bg-card)',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border-hi)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '12px', fontWeight: 700,
          color: open ? '#fff' : 'var(--text-3)',
          fontFamily: 'var(--font-mono)',
        }}>
          {number}
        </div>
        <span style={{ fontSize: '14px', fontWeight: 600, color: open ? '#bfdbfe' : 'var(--text-1)', flex: 1 }}>
          {title}
        </span>
        <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div style={{ padding: '16px', background: 'var(--bg-card)', fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.65 }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Field/value table row ────────────────────────────────────────────────────
function FieldRow({ field, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontWeight: 500, color: 'var(--text-1)' }}>{field}</span>
      <span style={{ fontFamily: mono ? 'var(--font-mono)' : 'inherit', fontSize: mono ? '11.5px' : '13px', color: 'var(--text-3)' }}>{value}</span>
    </div>
  )
}

// ─── Note callout ─────────────────────────────────────────────────────────────
function Note({ type = 'info', children }) {
  const s = {
    info:    { bg: 'var(--bg-input)',           border: 'var(--border-hi)', color: 'var(--text-3)'  },
    tip:     { bg: 'var(--accent-dim)',          border: 'var(--accent)',    color: '#93c5fd'        },
    warn:    { bg: 'rgba(245,158,11,0.1)',       border: 'var(--amber)',     color: '#fcd34d'        },
    success: { bg: 'var(--green-dim)',           border: 'var(--green)',     color: '#6ee7b7'        },
  }[type] || { bg: 'var(--bg-input)', border: 'var(--border-hi)', color: 'var(--text-3)' }

  return (
    <div style={{ marginTop: '10px', padding: '10px 14px', background: s.bg, border: `1px solid ${s.border}`, borderRadius: 'var(--radius-sm)', fontSize: '12.5px', color: s.color, lineHeight: 1.6 }}>
      {children}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function SetupGuide({ onClose }) {
  const [deployedOrigin, setDeployedOrigin] = useState(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const origin = window.location.origin
      const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      const isLanIp    = /^https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(origin)
      if (!isLocalhost && !isLanIp) {
        setDeployedOrigin(origin)
      }
    }
  }, [])

  const localUrl   = 'http://localhost:3000/auth/callback'
  const vercelUrl  = deployedOrigin
    ? `${deployedOrigin}/auth/callback`
    : 'https://sf-meta-exporter.vercel.app/auth/callback'
  const isOnVercel = !!deployedOrigin

  const isLanIp = typeof window !== 'undefined' &&
    /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(window.location.hostname)

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)',
        }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 201,
        width: 'min(720px, calc(100vw - 32px))',
        maxHeight: 'calc(100vh - 48px)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-hi)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: '0 40px 120px rgba(0,0,0,0.9)',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          padding: '18px 22px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-dark)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-1)', marginBottom: '3px' }}>
              Salesforce External Client App — Setup Guide
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-3)' }}>
              One-time setup per Salesforce org · Your Consumer Key never leaves your browser
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: '30px', height: '30px', borderRadius: '50%',
              background: 'var(--bg-card)', border: '1px solid var(--border-hi)',
              color: 'var(--text-2)', fontSize: '16px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: '16px 22px 22px', flex: 1 }}>

          {/* LAN IP warning */}
          {isLanIp && (
            <div style={{
              marginBottom: '16px', padding: '12px 14px',
              background: 'rgba(245,158,11,0.1)', border: '1px solid var(--amber)',
              borderRadius: 'var(--radius-md)', fontSize: '12.5px', color: '#fcd34d', lineHeight: 1.6,
            }}>
              <strong>⚠ You're accessing via a LAN IP ({window.location.hostname})</strong><br />
              Salesforce does not allow HTTP callbacks to non-localhost addresses.
              Switch to <strong style={{ fontFamily: 'var(--font-mono)' }}>http://localhost:3000</strong> in your browser.
            </div>
          )}

          {/* Callback URLs summary — always visible at the top */}
          <div style={{
            marginBottom: '18px', padding: '14px 16px',
            background: 'var(--accent-dim)', border: '1px solid var(--accent)',
            borderRadius: 'var(--radius-md)',
          }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#93c5fd', marginBottom: '12px' }}>
              📋 Add BOTH of these as Callback URLs in your External Client App (see Step 4)
            </div>
            <CallbackRow
              value={localUrl}
              label="Local development (localhost)"
            />
            <CallbackRow
              value={vercelUrl}
              label={isOnVercel ? `Production — ${deployedOrigin}` : 'Production — Vercel deployment'}
              labelColor={isOnVercel ? '#6ee7b7' : 'var(--text-3)'}
            />
            {!isOnVercel && (
              <p style={{ marginTop: '6px', fontSize: '11.5px', color: 'var(--text-3)' }}>
                💡 Not deployed to Vercel yet? Add the localhost URL now and add the Vercel URL to the same External Client App after you deploy — no need to create a new one.
              </p>
            )}
          </div>

          {/* Step 1 */}
          <Step number={1} title="Log in to Salesforce and open Setup">
            <p>Log in to your Salesforce org in a browser.</p>
            <p style={{ marginTop: '8px' }}>Click the <strong>⚙ gear icon</strong> (top-right) → <strong>Setup</strong>.</p>
          </Step>

          {/* Step 2 */}
          <Step number={2} title="Open External Client App Manager">
            <p>In the <strong>Quick Find</strong> box on the left, type:</p>
            <div style={{ margin: '10px 0', padding: '8px 12px', background: 'var(--bg-page)', border: '1px solid var(--border-hi)', borderRadius: 'var(--radius-sm)' }}>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: '#6ee7b7' }}>External Client App Manager</code>
            </div>
            <p>Click <strong>External Client App Manager</strong> in the results.</p>
            <p style={{ marginTop: '8px' }}>Then click <strong style={{ color: '#bfdbfe' }}>"New External Client App"</strong> in the top-right.</p>
            <Note type="info">
              💡 Older orgs may show <strong>App Manager</strong> instead — click <strong>New Connected App</strong> there. The OAuth settings are identical.
            </Note>
          </Step>

          {/* Step 3 */}
          <Step number={3} title="Fill in Basic Information">
            <div style={{ display: 'grid', gap: '2px' }}>
              <FieldRow field="External Client App Name" value="SFMetaExporter" mono />
              <FieldRow field="API Name"                 value="SFMetaExporter  (auto-filled)" mono />
              <FieldRow field="Contact Email"            value="your email address" />
              <FieldRow field="Distribution State"       value="Local" mono />
            </div>
          </Step>

          {/* Step 4 */}
          <Step number={4} title="Enable OAuth and add Callback URLs">
            <p>Scroll to the <strong>OAuth Settings</strong> section and check <strong>"Enable OAuth Settings"</strong>.</p>
            <p style={{ marginTop: '12px', fontWeight: 600, color: 'var(--text-1)' }}>Add both of these as Callback URLs (one per line):</p>
            <div style={{ marginTop: '10px' }}>
              <CallbackRow value={localUrl}  label="Local development" />
              <CallbackRow value={vercelUrl} label={isOnVercel ? 'Production (this deployment)' : 'Production · Vercel deployment'} labelColor={isOnVercel ? '#6ee7b7' : 'var(--text-3)'} />
            </div>
            <Note type="tip">
              Salesforce accepts multiple callback URLs in one External Client App — so the same Consumer Key works whether you run locally or on Vercel.
            </Note>
          </Step>

          {/* Step 5 */}
          <Step number={5} title="Add OAuth Scopes">
            <p>Still in OAuth Settings, click <strong>Add</strong> to add these scopes:</p>
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {[
                { scope: 'refresh_token', label: 'Perform requests at any time (refresh_token, offline_access)', required: true  },
                { scope: 'full',          label: 'Full access (full)',                                            required: true, note: 'Recommended — needed for Metadata API operations' },
              ].map(({ scope, label, required, note }) => (
                <div key={scope} style={{
                  display: 'flex', alignItems: 'flex-start', gap: '10px',
                  padding: '8px 10px',
                  background: required ? 'var(--bg-input)' : 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent-hi)', flexShrink: 0, paddingTop: '1px' }}>{scope}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12.5px', color: 'var(--text-2)' }}>{label}</div>
                    {note && <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>{note}</div>}
                  </div>
                  <span style={{
                    fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
                    background: required ? 'var(--accent-dim)' : 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    color: required ? '#bfdbfe' : 'var(--text-3)', flexShrink: 0,
                  }}>
                    {required ? 'required' : 'optional'}
                  </span>
                </div>
              ))}
            </div>
          </Step>

          {/* Step 6 */}
          <Step number={6} title="Configure Flow Enablement and Security">
            <p style={{ marginBottom: '12px' }}>Still in OAuth Settings, set the following:</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12.5px' }}>
              <div style={{ padding: '10px 12px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-1)', marginBottom: '6px' }}>Flow Enablement</div>
                <div style={{ color: 'var(--text-2)' }}>✅ Check &nbsp;<strong>"Enable Authorization Code and Credentials Flow"</strong></div>
                <div style={{ color: '#fca5a5', marginTop: '5px' }}>⚠ Leave &nbsp;<strong>"Require user credentials in POST body"</strong>&nbsp; <em>unchecked</em></div>
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-1)', marginBottom: '6px' }}>Security</div>
                <div style={{ color: 'var(--text-2)' }}>✅ Check &nbsp;<strong>"Require Proof Key for Code Exchange (PKCE)"</strong></div>
                <div style={{ color: 'var(--text-2)', marginTop: '5px' }}>❌ Uncheck <strong>"Require secret for Web Server Flow"</strong>&nbsp; (no secret needed with PKCE)</div>
                <div style={{ color: 'var(--text-2)', marginTop: '5px' }}>❌ Uncheck <strong>"all options except the first one. </strong></div>
              </div>
            </div>
          </Step>

          {/* Step 7 */}
          <Step number={7} title="Save and configure Policies">
            <p>Click <strong>Create</strong> at the bottom of the form.</p>
            <Note type="warn">⏳ Salesforce can take 2–10 minutes to activate a new External Client App.</Note>
            <p style={{ marginTop: '12px' }}>After saving, go to the <strong>Policies</strong> tab → click <strong>Edit</strong> and set:</p>
            <div style={{ marginTop: '10px', display: 'grid', gap: '2px' }}>
              <FieldRow field="Permitted Users" value="All users may self-authorize" />
              <FieldRow field="IP Relaxation"   value="Relax IP restrictions" />
              <FieldRow field="Refresh Token"   value="Refresh token is valid until revoked" />
            </div>
            <p style={{ marginTop: '10px' }}>Click <strong>Save</strong>.</p>
          </Step>

          {/* Step 8 */}
          <Step number={8} title="Copy your Consumer Key and connect">
            <p>On the <strong>Settings</strong> tab → scroll to <strong>OAuth Settings</strong> → click <strong>"Consumer Key and Secret"</strong>.</p>
            <p style={{ marginTop: '8px' }}>Verify with the emailed code, then copy your <strong>Consumer Key</strong>.</p>
            <div style={{ marginTop: '12px', padding: '10px 14px', background: 'var(--bg-input)', border: '1px solid var(--border-hi)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-1)', marginBottom: '6px' }}>Consumer Key looks like:</div>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-3)' }}>
                3MVG9A_Pq3U...&nbsp;&nbsp;(starts with 3MVG for most orgs)
              </code>
            </div>
            <Note type="success">
              You do <strong>not</strong> need the Consumer Secret. This app uses PKCE — same as the Python desktop version — so no secret is ever required or transmitted.
            </Note>
            <p style={{ marginTop: '12px' }}>
              Paste the Consumer Key into the login page, choose your org type, and click <strong>Connect with Salesforce</strong>.
              A popup opens for Salesforce login — after approving, it closes automatically and you're taken to the dashboard.
            </p>
          </Step>

          {/* Multi-user note */}
          <div style={{ marginTop: '8px', padding: '14px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-2)', marginBottom: '8px' }}>ℹ Shared / multi-user deployments</div>
            <div style={{ fontSize: '12.5px', color: 'var(--text-3)', lineHeight: 1.65 }}>
              Each user creates their own External Client App in <em>their own</em> Salesforce org, pointing to the shared Vercel URL.
              Everyone enters their own Consumer Key on the login page — no credentials are ever shared between users, and the server never sees your Consumer Key.
            </div>
          </div>

        </div>

        {/* Footer */}
        <div style={{ padding: '12px 22px', borderTop: '1px solid var(--border)', background: 'var(--bg-dark)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <a
            href="https://help.salesforce.com/s/articleView?id=sf.connected_app_create_api_integration.htm"
            target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '12px', color: 'var(--accent-hi)', textDecoration: 'none' }}
          >
            Salesforce docs → Creating Connected Apps ↗
          </a>
          <button
            onClick={onClose}
            style={{ padding: '8px 20px', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-outfit)' }}
          >
            Got it →
          </button>
        </div>
      </div>
    </>
  )
}
