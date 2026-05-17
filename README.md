# SF Meta Exporter — Web Edition
## Phase 1: Foundation & Authentication

---

## What's in this phase

- **Login page** — Consumer Key input, org type selector (Production / Sandbox / Custom Domain)
- **OAuth 2.0 PKCE flow** — secure, passwordless login via popup window
- **Session management** — encrypted `httpOnly` cookie via `iron-session`
- **Salesforce client** — server-side API wrapper (`lib/salesforce/client.js`)
- **Dashboard shell** — sidebar navigation, status log, 6 module cards (all "coming soon")
- **Auto-redirect** — `/` routes to `/dashboard` if authenticated, `/login` if not

---

## Quick start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment variables
```bash
cp .env.example .env.local
```

Edit `.env.local`:
```
SESSION_SECRET=your-super-secret-password-at-least-32-chars
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Run locally
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Salesforce setup (one-time per org)

You need a **Consumer Key** from a Salesforce External Client App.

1. In Salesforce: **Setup → App Manager → New External Client App**
2. Fill in:
   - App Name: `SF Meta Exporter`
   - Callback URL: `http://localhost:3000/auth/callback`
     *(add your production URL too when deploying)*
   - OAuth Scopes: `api`, `refresh_token`
3. Click **Save**, then copy the **Consumer Key**
4. Paste it into the login page

---

## Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Set these environment variables in the Vercel dashboard:
- `SESSION_SECRET` — at least 32 random characters
- `NEXT_PUBLIC_APP_URL` — your Vercel app URL (e.g. `https://sfmeta.vercel.app`)

Add your Vercel app URL as an additional **Callback URL** in your Salesforce External Client App.

---

## Project structure

```
app/
  (auth)/login/page.js     ← Login UI
  auth/callback/page.js    ← OAuth popup callback
  dashboard/
    layout.js              ← Session guard + sidebar
    page.js                ← Module cards overview
  api/auth/
    initiate/route.js      ← Generates PKCE pair, returns auth URL
    exchange/route.js      ← Exchanges auth code for access token
    logout/route.js        ← Clears session
    session/route.js       ← Returns session status (no secrets)

lib/
  session.js               ← iron-session config
  config.js                ← Constants (mirrors config.py)
  salesforce/client.js     ← SF API wrapper (mirrors salesforce_client.py)

components/
  Sidebar.js               ← Dashboard navigation
  StatusLog.js             ← Scrolling log panel (used by all modules)
```

---

## Phase roadmap

| Phase | Module | Status |
|-------|--------|--------|
| 1 | Auth + Shell | ✅ **This ZIP** |
| 2 | Core infrastructure (SSE, file gen) | Upcoming |
| 3 | Picklist Exporter | Upcoming |
| 4 | Metadata Exporter + Field Usage | Upcoming |
| 5 | ContentDocument Downloader | Upcoming |
| 6 | SOQL Runner | Upcoming |
| 7 | SF Switch + Trigger Deployer | Upcoming |
| 8 | Report Exporter + Polish | Upcoming |
