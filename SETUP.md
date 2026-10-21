# How to set up theblackbox

This guide runs the complete app on a fresh Ubuntu 24.04 server: Nginx serves a frontend-only folder, Gunicorn runs Flask privately, and SQLite stays outside the web root. Windows users can follow it inside Ubuntu on WSL for local development. Public HTTPS needs a publicly reachable server and a hostname pointing to it.

The repository contains ready-to-serve frontend assets. The original frontend build project is unavailable, so there is no `npm install` or frontend build step.

## 1. Install the server tools

Run these commands in the Ubuntu terminal using an account with sudo access:

```bash
sudo apt update
sudo apt install -y git python3 python3-venv nginx certbot python3-certbot-nginx
```

Open the repository on GitHub, choose **Code → HTTPS**, and copy its clone URL. The next command asks for it without embedding an owner's username in this guide:

```bash
read -r -p 'Repository HTTPS clone URL: ' REPOSITORY_URL
sudo install -d -m 755 /srv/theblackbox
sudo git clone "$REPOSITORY_URL" /srv/theblackbox/app
cd /srv/theblackbox/app
sudo python3 -m venv .venv
sudo .venv/bin/pip install -r requirements.txt
```

Use a public clone URL without a token in it. For a private fork, authenticate with GitHub's supported credential flow rather than putting a token into the URL.

## 2. Create the application account and private configuration

These commands create a dedicated service account and a database directory. Run `useradd` only once on a fresh installation:

```bash
sudo useradd --system --home /srv/theblackbox --shell /usr/sbin/nologin theblackbox
sudo install -d -o theblackbox -g theblackbox -m 750 /var/lib/theblackbox
sudo install -o root -g theblackbox -m 640 .env.example /etc/theblackbox.env
sudoedit /etc/theblackbox.env
```

In the editor, fill in `TMDB_API_TOKEN` using your own TMDB read access token. Obtain it from your TMDB account's API settings. Keep the database path outside the checkout:

```dotenv
TMDB_API_TOKEN=YOUR_OWN_TMDB_READ_ACCESS_TOKEN
MOVIESITE_SYNC_DB=/var/lib/theblackbox/sync.sqlite3
MOVIESITE_ADMIN_SYNC_KEY=
GOOGLE_BOOKS_API_KEY=
```

Do not copy the completed file into Git or the frontend folder. Flask does not automatically load `.env.example`; systemd loads `/etc/theblackbox.env` below. A TMDB API key can be supplied as `TMDB_API_KEY` instead of a bearer token.

### Optional: enable watch-together access

Watch-together access is disabled unless `MOVIESITE_ADMIN_SYNC_KEY` is configured. Choose a long, unique sync passphrase and generate its SHA-256 value without putting the passphrase in shell history:

```bash
python3 - <<'PY'
import getpass, hashlib
phrase = getpass.getpass('Choose a strong sync passphrase: ')
if len(phrase) < 20:
    raise SystemExit('Use a longer passphrase, then try again.')
print(hashlib.sha256(phrase.encode('utf-8')).hexdigest())
PY
```

Set `MOVIESITE_ADMIN_SYNC_KEY` to that value in `/etc/theblackbox.env`. Treat the hash as a credential too. In the site's sync interface, create or connect using the same passphrase before using watch-together rooms. Restart the service after changing its environment file.

## 3. Export the public frontend

Serve this export rather than the application checkout. The export tool copies tracked frontend files and excludes backend code, secrets, documentation, and databases. The destination must be new or empty:

```bash
cd /srv/theblackbox/app
sudo .venv/bin/python scripts/export_public.py /srv/theblackbox/public
```

## 4. Run Flask as a background service

Create the service:

```bash
sudo tee /etc/systemd/system/theblackbox.service >/dev/null <<'EOF'
[Unit]
Description=theblackbox application API
After=network-online.target
Wants=network-online.target

[Service]
User=theblackbox
Group=theblackbox
WorkingDirectory=/srv/theblackbox/app
EnvironmentFile=/etc/theblackbox.env
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=/srv/theblackbox/app/.venv/bin/gunicorn --workers 2 --threads 8 --bind 127.0.0.1:5001 --access-logfile - wsgi:app
Restart=on-failure
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/theblackbox

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now theblackbox
sudo systemctl status theblackbox --no-pager
```

Gunicorn listens on localhost, behind Nginx, and runs without root privileges. See [Flask's Gunicorn deployment documentation](https://flask.palletsprojects.com/en/stable/deploying/gunicorn/).

## 5. Connect the hostname and Nginx

Point your domain's DNS A record to your server's public IPv4 address. For local WSL use, you can use `localhost` and skip the public HTTPS step. Do not publish private server details or passwords in this repository.

Enter only a hostname, such as `movies.example.com`, without `https://` or a path:

```bash
read -r -p 'Site hostname: ' SITE_HOST
if [[ ! "$SITE_HOST" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
  echo 'Invalid hostname. Enter a hostname only.'
  exit 1
fi
sudo tee /etc/nginx/sites-available/theblackbox >/dev/null <<'EOF'
server {
    listen 80;
    server_name SITE_HOST_PLACEHOLDER;
    root /srv/theblackbox/public;
    index index.html;

    location ^~ /.well-known/acme-challenge/ { try_files $uri =404; }
    location ~ /\. { deny all; }
    location ~* \.(py|sqlite3?|db|env|pem|key|log|bak)$ { deny all; }

    location /api/ {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 3600;
    }
    location /ext/ {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 120;
    }
    location /embed/ {
        proxy_pass http://127.0.0.1:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location ~* \.(css|js|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|webmanifest|json)$ {
        try_files $uri =404;
    }
    location / { try_files $uri $uri/ /index.html; }
}
EOF
sudo sed -i "s/SITE_HOST_PLACEHOLDER/$SITE_HOST/g" /etc/nginx/sites-available/theblackbox
sudo ln -s /etc/nginx/sites-available/theblackbox /etc/nginx/sites-enabled/theblackbox
sudo nginx -t
sudo systemctl reload nginx
```

On a server hosting other sites, keep their configuration intact. On a fresh server, Nginx's default site may still answer requests to the bare IP; test using the configured hostname. Allow inbound TCP ports 80 and 443 in your hosting provider's firewall. Keep your existing SSH access allowed if configuring an operating-system firewall.

## 6. Enable HTTPS

For a public hostname that already resolves to this server:

```bash
sudo certbot --nginx -d "$SITE_HOST" --redirect
sudo certbot renew --dry-run
systemctl list-timers --all | grep certbot
```

Follow Certbot's prompts using your own contact details. Skip this section for `localhost`. If issuance fails, confirm DNS points to this machine and port 80 is reachable. See the [official Certbot instructions](https://certbot.eff.org/instructions).

## 7. Verify the installation

```bash
curl -I "https://$SITE_HOST/"
curl -I "https://$SITE_HOST/source-catalog.js"
curl -s -o /dev/null -w 'Metadata API: %{http_code}\n' "https://$SITE_HOST/api/tmdb/trending/movie/week"
curl -s -o /dev/null -w 'Backend source blocked: %{http_code}\n' "https://$SITE_HOST/app_main.py"
sudo journalctl -u theblackbox -n 50 --no-pager
```

Use `http://` instead if testing locally without HTTPS. Expect successful page and API responses; backend source must return 403 or 404. In a browser, check movies, a TV season, next-episode navigation, and source switching. Third-party playback varies by title and region. Only Videasy currently has a verified progress-saving integration.

## Update later

After the initial privacy cleanup, start from a fresh clone; do not merge old history back. For subsequent normal updates, run:

```bash
cd /srv/theblackbox/app
sudo git pull --ff-only
sudo .venv/bin/pip install -r requirements.txt
sudo .venv/bin/python -m compileall -q app_main.py books_backend.py theater_backend.py wsgi.py
PUBLIC_RELEASE="/srv/theblackbox/public-$(date -u +%Y%m%dT%H%M%SZ)"
sudo .venv/bin/python scripts/export_public.py "$PUBLIC_RELEASE"
```

Back up the database consistently using Python's SQLite backup API before backend changes:

```bash
sudo -u theblackbox /srv/theblackbox/app/.venv/bin/python - <<'PY'
import datetime, sqlite3
target = '/var/lib/theblackbox/backup-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.sqlite3'
with sqlite3.connect('/var/lib/theblackbox/sync.sqlite3') as source:
    with sqlite3.connect(target) as backup:
        source.backup(backup)
print('Database backup created outside the public folder.')
PY
sudo systemctl restart theblackbox
```

Edit Nginx's `root` to the new `PUBLIC_RELEASE` path, run `sudo nginx -t`, reload Nginx, and repeat the browser checks. Keep the previous public folder for rollback. Never upload database backups to GitHub.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Homepage loads but titles do not | `/etc/theblackbox.env` has a valid TMDB credential; restart the service after editing it. |
| Nginx shows 502 | Check `systemctl status theblackbox` and the service log. Confirm port 5001 is listening on localhost. |
| Database permission error | `/var/lib/theblackbox` belongs to the service account and the environment points to that directory. |
| An asset returns 404 | Export from the repository root using the supplied tool; verify Nginx points to that export. |
| A source fails | Switch providers. An iframe load alone does not prove media is available. |
| Watch-together returns 403 | Configure your own admin sync key and use the matching passphrase. No default admin credential is shipped. |
| Browser shows an older interface | Reload the page and clear that site's service-worker cache if needed. |

The repository does not contain your server password, real environment file, viewing database, or personal deployment settings. Supply these privately for each installation.
