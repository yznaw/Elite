# Deployment Guide - Elite Collection

## Server Information
- **Host:** Contabo VPS
- **IP:** vmi3327182
- **Project Path:** `/var/www/elite`
- **App Process:** `elite-api` (PM2)
- **Port:** `3000` (API running at http://localhost:3000/api)
- **Environment:** production

---

## Quick Deploy Command

```bash
cd /var/www/elite && git pull origin main && npm install && pm2 restart elite-api
```

---

## Step-by-Step Deployment

### 1. SSH into Server
```bash
ssh root@vmi3327182
```

### 2. Navigate to Project Directory
```bash
cd /var/www/elite
```

### 3. Pull Latest Code
```bash
git pull origin main
```

### 4. Install Dependencies (if needed)
```bash
npm install
```

### 5. Fix Vulnerabilities
```bash
npm audit fix
```

### 6. Restart Application
```bash
pm2 restart elite-api
```

---

## Verification Commands

### Check App Status
```bash
pm2 status
```

### View Logs (last 30 lines)
```bash
pm2 logs elite-api --lines 30
```

### View Error Logs Only
```bash
pm2 logs elite-api --err --lines 30
```

### Watch Logs in Real-Time
```bash
pm2 logs elite-api
# Press Ctrl+C to exit
```

### Check Process Details
```bash
pm2 show elite-api
```

---

## Database & Known Issues

### Current Known Errors
- `Tenant bootstrap failed` - view schema mismatch (non-critical)
- `column "size_chart" does not exist` - missing migration
- `invalid input syntax for type uuid` - data type mismatch in carts

### Run Pending Migrations (if applicable)
```bash
cd /var/www/elite/server
npm run migrate
```

---

## Useful PM2 Commands

### Restart App
```bash
pm2 restart elite-api
```

### Stop App
```bash
pm2 stop elite-api
```

### Start App
```bash
pm2 start elite-api
```

### View All Running Processes
```bash
pm2 list
```

### Save PM2 Process List
```bash
pm2 save
pm2 startup
```

---

## Upload Storage
- **Path:** `/var/www/elite-uploads`
- **Size:** ~135MB

---

## Deployment Checklist

- [ ] SSH into server: `ssh root@vmi3327182`
- [ ] Navigate to project: `cd /var/www/elite`
- [ ] Pull latest code: `git pull origin main`
- [ ] Install dependencies: `npm install`
- [ ] Restart app: `pm2 restart elite-api`
- [ ] Verify status: `pm2 status`
- [ ] Check logs: `pm2 logs elite-api --lines 30`

---

## Emergency Rollback

If something breaks, you can rollback to previous commit:

```bash
cd /var/www/elite
git log --oneline -10  # View last 10 commits
git reset --hard <commit-hash>
pm2 restart elite-api
```

---

## Contact & Support
- **Project:** Elite Collection Admin Portal
- **Repository:** https://github.com/yznaw/Elite
- **Main Branch:** main
- **Local Dev:** `admin-bugs-fixes` (feature branch)
