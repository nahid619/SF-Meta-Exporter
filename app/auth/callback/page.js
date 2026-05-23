// app/auth/callback/page.js
'use client'

import { useEffect, useState } from 'react'

/**
 * This page opens inside a popup window after Salesforce redirects back.
 * It exchanges the auth code for a token, then posts LOGIN_SUCCESS to the
 * parent window and closes itself.
 *
 * Mirrors the _CallbackHandler in oauth_handler.py — same three states:
 * processing → success → (close) or error → (close).
 *
 * IMPORTANT: the error branches also auto-close after a delay. Leaving the
 * popup open caused retries to re-use the stale window (named-target reuse),
 * which combined with Salesforce's SSO cookie made it look like the second
 * attempt failed without ever showing a login form.
 */
const ERROR_CLOSE_DELAY_MS   = 2500
const SUCCESS_CLOSE_DELAY_MS = 1400

export default function CallbackPage() {
  const [status,  setStatus]  = useState('processing') // 'processing' | 'success' | 'error'
  const [message, setMessage] = useState('Completing login…')

  useEffect(() => {
    const params     = new URLSearchParams(window.location.search)
    const code       = params.get('code')
    const sfError    = params.get('error')
    const sfErrorDesc = params.get('error_description')

    // Salesforce returned an error on the redirect
    if (sfError) {
      const msg = sfErrorDesc || sfError
      failWith(msg)
      return
    }

    if (!code) {
      failWith('No authorization code in callback URL.')
      return
    }

    // Exchange the code for an access token
    fetch('/api/auth/exchange', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          failWith(data.error)
        } else {
          setStatus('success')
          setMessage(`Connected to ${data.instanceUrl || 'Salesforce'}`)
          notifyParent('LOGIN_SUCCESS')
          // Close popup after a short delay so user sees the success screen
          setTimeout(() => window.close(), SUCCESS_CLOSE_DELAY_MS)
        }
      })
      .catch(err => {
        const msg = err.message || 'Unknown error during token exchange.'
        failWith(msg)
      })

    function failWith(msg) {
      setStatus('error')
      setMessage(msg)
      notifyParent(`LOGIN_ERROR:${msg}`)
      // Auto-close on error too — prevents the next login attempt from
      // re-using a stale popup. The user already sees the error on the
      // parent page, so they don't need this window lingering.
      setTimeout(() => { try { window.close() } catch {} }, ERROR_CLOSE_DELAY_MS)
    }
  }, [])

  function notifyParent(msg) {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(msg, window.location.origin)
      }
    } catch {}
  }

  const icons = { processing: '⏳', success: '✅', error: '❌' }
  const titles = {
    processing: 'Connecting…',
    success:    'Login Successful!',
    error:      'Login Failed',
  }
  const subtexts = {
    processing: 'Exchanging credentials with Salesforce.',
    success:    'This window will close automatically.',
    error:      'This window will close automatically. You can retry from the main page.',
  }

  return (
    <div className="callback-wrap bg-dots">
      <div className="callback-card">
        <div className="callback-icon">{icons[status]}</div>
        <h2 className="callback-title">{titles[status]}</h2>
        <p className="callback-msg">{message}</p>
        <p className="callback-msg" style={{ marginTop: '8px', opacity: 0.6, fontSize: '12px' }}>
          {subtexts[status]}
        </p>
        {status === 'error' && (
          <button
            onClick={() => window.close()}
            style={{
              marginTop: '20px',
              padding: '8px 20px',
              background: 'var(--bg-card-alt)',
              border: '1px solid var(--border-hi)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-2)',
              cursor: 'pointer',
              fontSize: '13px',
              fontFamily: 'var(--font-outfit)',
            }}
          >
            Close Now
          </button>
        )}
      </div>
    </div>
  )
}
