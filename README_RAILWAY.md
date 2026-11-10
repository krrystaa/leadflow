# LEADFLOW — Railway deployment

## Repository layout
- `site/` — public website and CRM files
- `server.js` — Express static-file server with security headers
- `package.json` — Railway start configuration

## Deploy
1. Create a GitHub repository and upload the **contents** of this folder (so `package.json` and `server.js` are at repository root).
2. In Railway choose **New Project → Deploy from GitHub Repo** and select the repository.
3. Railway should detect Node.js. Start command: `npm start`.
4. In the service settings, open **Networking → Generate Domain**.
5. Test `/` and `/crm.html`.

## Supabase
After Railway creates the public domain, update Supabase Authentication → URL Configuration:
- Site URL: `https://YOUR-RAILWAY-DOMAIN`
- Redirect URL: `https://YOUR-RAILWAY-DOMAIN/crm.html`

Keep the Supabase database and Edge Function where they are. Never put a Supabase `service_role` key in browser code or GitHub.

## Important
The original `_headers` file is Netlify-specific and is not used by this Node server. The relevant security headers are configured in `server.js`.
