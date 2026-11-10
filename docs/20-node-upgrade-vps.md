# 20 — Upgrading Node on the Production VPS (Node 20 → 22 LTS)

**Why:** the Angular 22 upgrade (Phase 6, commit `84e72d6`) requires Node
`^22.22.3 || ^24.15.0 || >=26.0.0` to build the client. `server/package.json`
already declared `"engines": { "node": "^22.0.0" }` before this session even
started, so this gap predates the Angular work — the VPS was already behind
what the server itself expected, and the stricter client requirement just
made it a hard build failure instead of a silent mismatch.

**Recommended target: Node 22 LTS** (satisfies both the server's `^22.0.0`
and the client's `^22.22.3` — confirm the exact patch version installed is
`22.22.3` or newer, since `22.0.0`–`22.22.2` would satisfy the server's
constraint but NOT the client's).

---

## 0. Check how Node is currently installed (don't skip this)

```bash
ssh root@vmi3327182
which node
node -v
cat /etc/os-release | grep PRETTY_NAME
```

Then check which install method is in play:

```bash
# If this shows a real path, Node was installed via NodeSource's apt repo:
apt list --installed 2>/dev/null | grep nodejs

# If this exists, Node is managed via nvm instead:
command -v nvm || ls ~/.nvm 2>/dev/null

# If this exists, Node came from a generic tarball/manual install:
ls -la /usr/local/node* /opt/node* 2>/dev/null
```

Use the matching section below — **don't mix methods** (e.g. don't add nvm
on top of an apt-installed Node without removing the apt one first, or PM2
may end up running a different Node version than your interactive shell).

---

## 1. If installed via NodeSource (apt) — most common on a plain Ubuntu/Debian VPS

```bash
# Remove the old NodeSource repo config for v20 first if present:
rm -f /etc/apt/sources.list.d/nodesource.list

# Add the Node 22 LTS NodeSource repo and install:
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

node -v   # should print v22.x.x, ideally >=22.22.3
npm -v
```

## 2. If installed via nvm

```bash
nvm install 22
nvm alias default 22
nvm use 22
node -v
```

**Important if using nvm:** PM2 needs to be told to use the new Node version
too, since it may have cached the old interpreter path:

```bash
pm2 delete elite-api
pm2 start /var/www/elite/server/index.js --name elite-api --interpreter "$(which node)"
pm2 save
```

## 3. If installed manually (tarball under /usr/local or /opt)

```bash
cd /usr/local
curl -O https://nodejs.org/dist/latest-v22.x/node-v22.22.3-linux-x64.tar.xz
tar -xf node-v22.22.3-linux-x64.tar.xz
# Repoint the existing symlinks (adjust paths to match how it's currently linked):
ln -sfn /usr/local/node-v22.22.3-linux-x64/bin/node /usr/local/bin/node
ln -sfn /usr/local/node-v22.22.3-linux-x64/bin/npm /usr/local/bin/npm
node -v
```

---

## 4. After upgrading, by any method: reinstall dependencies and rebuild

Native Node addons and some packages are compiled/cached per Node major
version — reinstalling from a clean `node_modules` avoids subtle
ABI-mismatch errors after a Node major bump.

```bash
cd /var/www/elite/server
rm -rf node_modules
npm install

cd /var/www/elite/client
rm -rf node_modules
npm install
npm run build:admin
npm run build:web

cd /var/www/elite
pm2 restart elite-api
pm2 logs elite-api --lines 50
```

---

## 5. Verify

- [ ] `node -v` on the VPS shows `v22.22.3` or newer (or `v24.15.0+`/`v26.0.0+`).
- [ ] `pm2 show elite-api` — confirm the process is actually running under the new Node (check `exec interpreter` in its output, or check `pm2 env <id>` for the resolved `NODE_ENV`/version if using nvm).
- [ ] `npm run build:admin` and `npm run build:web` both complete successfully with no `EBADENGINE`/"requires a minimum Node.js version" errors.
- [ ] `pm2 logs elite-api --lines 50` shows the API booting cleanly, no fatal errors.
- [ ] Visit the admin portal and storefront in a browser — both load normally after the rebuild.

Once this is done, resume from wherever you left off in
`docs/19-full-test-plan.md` §0.1 (redeploy) onward — the rest of that test
plan is unaffected by this Node upgrade, it was just blocked from starting.
