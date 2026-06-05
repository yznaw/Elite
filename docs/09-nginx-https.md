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

Create `/etc/nginx/sites-available/elite`:

```nginx
# Express stays private. Nginx is the public HTTPS edge.
upstream elite_api {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name elitecollections.qa www.elitecollections.qa;

    root /var/www/elite/client/dist/client-web/browser;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://elite_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    location /uploads/ {
        alias /var/www/elite/server/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}

server {
    listen 80;
    server_name admin.elitecollections.qa;

    root /var/www/elite/client/dist/admin-portal/browser;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://elite_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    location /uploads/ {
        alias /var/www/elite/server/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

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
