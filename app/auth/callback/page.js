'use client'

import { useEffect, useState } from 'react'

/**
 * This page opens inside a popup window after Salesforce redirects back.
 * It exchanges the auth code for a token, then posts LOGIN_SUCCESS to the
 * parent window and closes itself.
 *
 * Mirrors the _CallbackHandler in oauth_handler.py — same three states:
 * processing → success → (close) or error.
 */
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
      setStatus('error')
      setMessage(msg)
      notifyParent(`LOGIN_ERROR:${msg}`)
      return
    }

    if (!code) {
      const msg = 'No authorization code in callback URL.'
      setStatus('error')
      setMessage(msg)
      notifyParent(`LOGIN_ERROR:${msg}`)
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
          setStatus('error')
          setMessage(data.error)
          notifyParent(`LOGIN_ERROR:${data.error}`)
        } else {
          setStatus('success')
          setMessage(`Connected to ${data.instanceUrl || 'Salesforce'}`)
          notifyParent('LOGIN_SUCCESS')
          // Close popup after a short delay so user sees the success screen
          setTimeout(() => window.close(), 1400)
        }
      })
      .catch(err => {
        const msg = err.message || 'Unknown error during token exchange.'
        setStatus('error')
        setMessage(msg)
        notifyParent(`LOGIN_ERROR:${msg}`)
      })
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
    error:      'Close this window and try again.',
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
            Close Window
          </button>
        )}
      </div>
    </div>
  )
}
