# Royal MD — Railway Deployment

Royal MD is a WhatsApp multi-device bot based on the supplied ArslanMD Mini Bot project. The original project license and upstream attribution are retained; check `LICENSE` before redistributing.

## Deploy to Railway

1. Extract this folder and upload it to a **private GitHub repository**. Do not commit `.env`, WhatsApp session credentials, or database credentials.
2. Create a Railway PostgreSQL database. Create a database user, allow Railway access in Network Access (prefer a restricted IP policy where possible), and copy the connection string.
3. In Railway, choose **New Project → Deploy from GitHub Repo** and select the repository. Railway should detect Node.js and use `npm start`.
4. In Railway → service → **Variables**, add these variables:
   - `DATABASE_URL` — your Railway PostgreSQL connection string (required for stored sessions/configuration)
   - `BOT_NAME` = `Royal MD`
   - `OWNER_NAME` = your display name
   - `OWNER_NUMBER` = your WhatsApp number with country code, digits only (for Kenya, e.g. `2547XXXXXXXX`)
   - `BOT_FOOTER` = `Powered by Royal MD`
   - `PREFIX` = `.`
   - `MODE` = `public` (or `private` if you want restricted bot behavior)
5. Add a Railway **public domain** in Settings → Networking if you want to use the pairing website endpoints. Open the generated domain and check that the app responds.
6. Use the project’s pairing page/API as implemented by this source to pair your own WhatsApp account. Keep the session private; never share pairing codes or session IDs.
7. Check **Deployments → Logs** for startup/database errors.

## Important notes

- `DATABASE_URL` must be valid; otherwise session persistence and related features will fail. Never paste database credentials into public chat or commit them to GitHub.
- If you want the bot's `.pair` command to call the pairing service, set `PAIRING_API_URL` to the public URL of this same Railway service, e.g. `https://your-service.up.railway.app` (no trailing slash).
- WhatsApp Web automation libraries can break when WhatsApp changes its protocol. Keep dependencies and the source updated, and use a number/account you control. Avoid unsolicited bulk messaging.
- Railway filesystems may be ephemeral; this project is configured to use PostgreSQL for saved session data.
- The project contains many third-party plugins. Review them before exposing the service publicly, especially downloaders, moderation, anti-delete, and group-management commands.

## Local test

```bash
cp .env.example .env
# Edit .env and set DATABASE_URL and OWNER_NUMBER
npm install
npm start
```

## Variables reference

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string; required for persistence |
| `BOT_NAME` | Bot display name |
| `OWNER_NAME` | Owner display name |
| `OWNER_NUMBER` | Owner WhatsApp number(s), comma-separated if multiple |
| `BOT_FOOTER` | Footer shown in bot messages |
| `PREFIX` | Command prefix |
| `MODE` | Bot operating mode |
| `PAIRING_API_URL` | Base URL used by `.pair` command |
