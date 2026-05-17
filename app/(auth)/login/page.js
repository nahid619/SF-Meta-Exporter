'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'

// SetupGuide uses window APIs — load client-side only
const SetupGuide = dynamic(() => import('@/components/SetupGuide'), { ssr: false })

const SF_CLOUD = (
  <svg width="20" height="14" viewBox="0 0 20 14" fill="none" aria-hidden>
    <path d="M8.3 2.4a3.7 3.7 0 0 1 6.6 1.5A3 3 0 0 1 17 9.5H5.5a3 3 0 0 1-.4-6 3.7 3.7 0 0 1 3.2-1.1Z" fill="currentColor"/>
  </svg>
)

function CallbackUrlBox() {
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setUrl(window.location.origin + '/auth/callback')
  }, [])

  async function copy() {
    try { await navigator.clipboard.writeText(url) } catch {}
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!url) return null
  return (
    <div style={{
      marginBottom: '20px',
      padding: '10px 12px',
      background: 'var(--accent-dim)',
      border: '1px solid var(--accent)',
      borderRadius: 'var(--radius-sm)',
    }}>
      <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#93c5fd', marginBottom: '6px' }}>
        ① Paste this into your Salesforce External Client App → Callback URL
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#6ee7b7', wordBreak: 'break-all' }}>
          {url}
        </code>
        <button
          onClick={copy}
          style={{ padding: '3px 10px', fontSize: '11px', background: copied ? 'var(--green-dim)' : 'var(--bg-input)', border: `1px solid ${copied ? 'var(--green)' : 'var(--border-hi)'}`, borderRadius: 'var(--radius-sm)', color: copied ? '#6ee7b7' : 'var(--text-3)', cursor: 'pointer', fontFamily: 'var(--font-outfit)', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <div style={{ marginTop: '5px', fontSize: '10.5px', color: '#93c5fd' }}>
        ② Then paste your Consumer Key below and click Connect
      </div>
    </div>
  )
}

const MODULES = [
  { icon: '📊', label: 'Picklist Exporter'  },
  { icon: '🔍', label: 'Metadata Exporter'  },
  { icon: '📁', label: 'File Downloader'    },
  { icon: '💻', label: 'SOQL Runner'        },
  { icon: '⚡', label: 'SF Switch'          },
  { icon: '📈', label: 'Report Exporter'    },
]

export default function LoginPage() {
  const router = useRouter()

  const [consumerKey,   setConsumerKey]   = useState('')
  const [orgType,       setOrgType]       = useState('production')
  const [customDomain,  setCustomDomain]  = useState('')
  const [isLoading,     setIsLoading]     = useState(false)
  const [error,         setError]         = useState(null)
  const [statusMsg,     setStatusMsg]     = useState(null)
  const [showGuide,     setShowGuide]     = useState(false)

  const popupRef = useRef(null)
  const pollRef  = useRef(null)

  useEffect(() => {
    const saved = localStorage.getItem('sfmeta_consumer_key')
    if (saved) setConsumerKey(saved)
  }, [])

  useEffect(() => () => {
    clearInterval(pollRef.current)
    popupRef.current?.close?.()
  }, [])

  async function handleLogin() {
    if (!consumerKey.trim()) {
      setError('Consumer Key is required. Click ? to see setup instructions.')
      return
    }

    setIsLoading(true)
    setError(null)
    setStatusMsg(null)
    localStorage.setItem('sfmeta_consumer_key', consumerKey.trim())

    try {
      const res  = await fetch('/api/auth/initiate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ consumerKey, orgType, domain: customDomain }),
      })
      const data = await res.json()

      if (data.error) { setError(data.error); setIsLoading(false); return }

      const w = 620, h = 720
      const left = Math.round((window.screen.width - w) / 2)
      const top  = Math.round((window.screen.height - h) / 2)

      popupRef.current = window.open(
        data.authUrl, 'sfmeta_auth',
        `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,location=no`
      )

      if (!popupRef.current) {
        setError('Popup was blocked. Allow popups for this page and try again.')
        setIsLoading(false)
        return
      }

      setStatusMsg('Waiting for Salesforce login in popup…')

      function handleMessage(evt) {
        if (evt.origin !== window.location.origin) return
        if (evt.data === 'LOGIN_SUCCESS') {
          cleanup()
          setStatusMsg('✓ Connected! Loading dashboard…')
          setTimeout(() => router.push('/dashboard'), 700)
        } else if (typeof evt.data === 'string' && evt.data.startsWith('LOGIN_ERROR:')) {
          cleanup()
          setError(evt.data.replace('LOGIN_ERROR:', ''))
          setIsLoading(false)
          setStatusMsg(null)
        }
      }

      window.addEventListener('message', handleMessage)
      pollRef.current = setInterval(() => {
        if (popupRef.current?.closed) {
          cleanup()
          setIsLoading(prev => { if (prev) { setError('Popup closed before completing login.'); setStatusMsg(null) } return false })
        }
      }, 800)

      function cleanup() {
        window.removeEventListener('message', handleMessage)
        clearInterval(pollRef.current)
      }
    } catch (err) {
      setError(err.message)
      setIsLoading(false)
    }
  }

  return (
    <>
      <div className="login-wrap bg-dots">
        <div className="login-card" style={{ position: 'relative' }}>

          {/* ── Help / Setup Guide button ──────────────────────────────── */}
          <button
            onClick={() => setShowGuide(true)}
            title="Salesforce setup instructions"
            style={{
              position: 'absolute', top: '14px', right: '14px', zIndex: 10,
              width: '28px', height: '28px', borderRadius: '50%',
              background: 'var(--bg-input)',
              border: '1px solid var(--border-hi)',
              color: 'var(--text-3)',
              fontSize: '13px', fontWeight: 700,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'border-color 0.15s, color 0.15s',
              fontFamily: 'var(--font-mono)',
            }}
          >
            ?
          </button>

          {/* ── Left branding panel ──────────────────────────────────────── */}
          <aside className="login-brand">
            <div className="brand-logo">
              <div className="brand-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden>
                  <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-7 14-5-5 1.4-1.4L12 14.2l7.6-7.6L21 8l-9 9Z"/>
                </svg>
              </div>
              <div>
                <div className="brand-name">SF Meta Exporter</div>
              </div>
            </div>

            <p className="brand-desc">
              Professional Salesforce metadata tooling for admins, DevOps engineers, and data analysts.
            </p>

            <div className="brand-divider" />

            <div style={{ fontSize: '11px', color: 'var(--text-3)', marginBottom: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>
              6 Modules
            </div>

            <div className="module-list">
              {MODULES.map(m => (
                <div key={m.label} className="module-item">
                  <span style={{ fontSize: '14px' }}>{m.icon}</span>
                  <span>{m.label}</span>
                </div>
              ))}
            </div>

            {/* Setup help teaser */}
            <button
              onClick={() => setShowGuide(true)}
              style={{
                marginTop: '20px',
                padding: '8px 12px',
                background: 'var(--accent-dim)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-sm)',
                color: '#bfdbfe',
                fontSize: '12px',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'var(--font-outfit)',
                width: '100%',
                lineHeight: 1.4,
              }}
            >
              ⚙ First time? Click to see how to create the Salesforce External Client App →
            </button>

          </aside>

          {/* ── Right form panel ─────────────────────────────────────────── */}
          <section className="login-form-panel">
            <h1 className="form-heading">Connect to Salesforce</h1>
            <p className="form-subheading">
              Sign in via OAuth 2.0 PKCE — no password stored.
            </p>

            {/* Consumer Key */}
            <div className="field-group">
              <label className="field-label" htmlFor="consumer-key">
                Consumer Key
              </label>
              <input
                id="consumer-key"
                type="text"
                className="field-input"
                placeholder="3MVG9…"
                value={consumerKey}
                onChange={e => setConsumerKey(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !isLoading && handleLogin()}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="field-hint">
                From Setup → App Manager → External Client App.{' '}
                <button
                  onClick={() => setShowGuide(true)}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-hi)', cursor: 'pointer', fontSize: 'inherit', padding: 0, fontFamily: 'inherit' }}
                >
                  Setup guide →
                </button>
              </p>
            </div>

            {/* Org type */}
            <div className="field-group">
              <label className="field-label">Org Type</label>
              <div className="seg-control">
                {[
                  { value: 'production', label: 'Production'    },
                  { value: 'sandbox',    label: 'Sandbox'       },
                  { value: 'custom',     label: 'Custom Domain' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`seg-btn ${orgType === opt.value ? 'active' : ''}`}
                    onClick={() => { setOrgType(opt.value); setError(null) }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom domain */}
            {orgType === 'custom' && (
              <div className="field-group">
                <label className="field-label" htmlFor="custom-domain">My Domain</label>
                <input
                  id="custom-domain"
                  type="text"
                  className="field-input"
                  placeholder="mycompany.my.salesforce.com"
                  value={customDomain}
                  onChange={e => setCustomDomain(e.target.value)}
                  autoComplete="off"
                />
              </div>
            )}

            {/* Button */}
            <button
              type="button"
              className="btn-primary"
              onClick={handleLogin}
              disabled={isLoading}
            >
              {isLoading
                ? <><div className="spinner" /> Waiting for Salesforce…</>
                : <>{SF_CLOUD} Connect with Salesforce</>
              }
            </button>

            {error && <div className="form-error">⚠ {error}</div>}
            {statusMsg && !error && (
              <div className="form-status">
                <div className="spinner" style={{ borderTopColor: 'var(--green)', borderColor: 'rgba(16,185,129,0.3)' }} />
                {statusMsg}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Setup Guide modal */}
      {showGuide && <SetupGuide onClose={() => setShowGuide(false)} />}
    </>
  )
}