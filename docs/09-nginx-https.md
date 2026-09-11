# 09 - Nginx HTTPS

Nginx should terminate public HTTPS for Elite. The Node/Express API stays on plain HTTP at `localhost:3000`; only Nginx is exposed to the internet on ports `80` and `443`.

## Target Layout

| Public URL | Nginx behavior | Upstream |
|---|---|---|
| `https://elitecollections.qa/` | Serves storefront Angular build | `/var/www/elite/client/dist/client-web/browser` |
| `https://admin.elitecollections.qa/` | Serves admin Angular build | `/var/www/elite/client/dist/admin-portal/browser` |
| `https://elitecollections.qa/api/*` | Proxies API requests | `http://127.0.0.1:3000` |
| `https://admin.elitecollections.qa/api/*` | Proxies API requests | `http://127.0.0.1:3000` |
| `https://*/uploads/*` | Serves uploaded media | `/var/www/elite/server/uploads` |

## App Environment

Keep the Express server behind Nginx:

```bash
PORT=3000
NODE_ENV=production
CORS_ORIGINS=https://elitecollections.qa,https://www.elitecollections.qa,https://admin.elitecollections.qa
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAMESITE=lax
```

`server/index.js` already enables `trust proxy` in production, so secure cookies work when Nginx forwards `X-Forwarded-Proto`.

## Install Nginx And Certbot

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
sudo systemctl enable nginx
```

Open the firewall if it is enabled:

```bash
sudo ufw allow 'Nginx Full'
```

## Create The Nginx Site

The site config lives in the repo at [`deploy/nginx/elite.conf`](../deploy/nginx/elite.conf).
Copy it to `/etc/nginx/sites-available/elite` rather than retyping it, so the
served config and the repo cannot drift.

```bash
sudo cp /var/www/elite/deploy/nginx/elite.conf /etc/nginx/sites-available/elite
```

It carries three things beyond a plain SPA host, each marked with a numbered
comment in the file:

1. **Compression.** Nginx's default `gzip_types` is `text/html` only, so the
   Angular bundle went out uncompressed: `main.js` is about 500 kB raw against
   roughly 120 kB gzipped. The HTML *was* compressed, which is what hid it.
   These directives sit at `http` context (the `sites-enabled` include is
   inside `http`), so do not move them inside a `server` block.
2. **A canonical host.** `www.elitecollections.qa` previously answered 200 and
   served the entire site. Since the storefront derives its canonical URL from
   `location.origin`, the www copy declared *itself* canonical, so the two
   hostnames competed as separate sites. www now only issues a 301.
3. **Caching.** `index.html` is `no-store` because it names the current build's
   hashed files. Hashed `.js`/`.css` are immutable for a year. `/assets/` is
   deliberately only 7 days, because those filenames are *not* hashed and a
   longer TTL would mean a replaced image takes a year to reach return visitors.

> **If certbot has already run on this server, do not overwrite the live file.**
> `certbot --nginx` rewrites it in place, adding `listen 443 ssl`, the
> certificate paths and its own port-80 redirects. Merge the three numbered
> blocks into the existing file instead.

Enable and reload it:

```bash
sudo ln -s /etc/nginx/sites-available/elite /etc/nginx/sites-enabled/elite
sudo nginx -t
sudo systemctl reload nginx
```

## Issue HTTPS Certificates

Make sure DNS points to the server before this step:

- `elitecollections.qa` A record -> server IP
- `www.elitecollections.qa` A record -> server IP
- `admin.elitecollections.qa` A record -> server IP

Then let Certbot update Nginx with certificate paths and HTTP-to-HTTPS redirects:

```bash
sudo certbot --nginx \
  -d elitecollections.qa \
  -d www.elitecollections.qa \
  -d admin.elitecollections.qa
```

Choose the redirect option when prompted. After that, Nginx owns HTTPS and forwards trusted proxy headers to Express.

## Verify

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run

curl -I http://elitecollections.qa
curl -I https://elitecollections.qa
curl -I https://admin.elitecollections.qa
curl https://admin.elitecollections.qa/api/health
```

Expected results:

- HTTP returns a redirect to HTTPS.
- HTTPS returns `200`.
- `/api/health` returns the Express health response.
- The browser shows a valid lock icon for both domains.
