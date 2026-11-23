# ChromaBook Studio — Server Deployment

Single-host Docker Compose deployment: `db` (PostgreSQL 16) and `web` (Node app). Processing runs inside `web`; there is no separate worker.

## Install
```bash
cp .env.example .env     # set POSTGRES_PASSWORD, optional GEMINI_API_KEY
docker compose up -d --build
curl http://127.0.0.1:3000/health
```
Migrations in `drizzle/` run automatically on every `web` start.

## Reverse proxy
The app has no authentication. Protect it (VPN, SSH tunnel, or proxy-level auth) before exposing it. See `nginx.example.conf`.

## Backups
```bash
docker compose exec db pg_dump -U chromabook chromabook > backup.sql
docker run --rm -v <project>_chromabook_data:/data -v "$PWD":/out alpine tar czf /out/data.tgz -C /data .
```

## Upgrade
`git pull && docker compose up -d --build`. After schema changes, run `npm run db:generate` in development and commit the new `drizzle/` files.

## Logs
`docker compose logs -f web`
