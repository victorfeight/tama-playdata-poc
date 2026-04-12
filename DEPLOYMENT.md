# Playdate Relay — DigitalOcean Deployment Guide

Complete step-by-step deployment of `tama-breed-poc` (the Paradise multiplayer
breeding / playdate relay + web client) to a DigitalOcean droplet, fronted by
Cloudflare DNS + Let's Encrypt TLS, running under `systemd` + `nginx`.

Reference host: **https://playdate.bbamorachi.us** · IP `24.199.69.115` (reserved).

---

## Final State (live reference)

| | |
|---|---|
| URL | **https://playdate.bbamorachi.us** |
| Health | `https://playdate.bbamorachi.us/health` → `{"ok":true}` |
| Sessions API | `POST https://playdate.bbamorachi.us/sessions` (header `x-poc-secret`) |
| WebSocket | `wss://playdate.bbamorachi.us/ws/:code?role=a|b&secret=...` |
| Droplet | DO Basic $4/mo · Ubuntu 24.04 · 512 MB + 2 GB swap · 10 GB disk |
| Region | SFO3 (must match the reserved IP's region) |
| Reserved IP | `24.199.69.115` |
| SSH | `ssh playdate` (user `vic`, port `222`, pubkey only, root disabled) |
| Firewall | UFW: 80/443 allow · 222 rate-limited · all else denied |
| Fail2ban | sshd jail: **1 failure → permanent ban**, persists across reboots |
| Service manager | `systemd` unit `playdate-relay.service` |
| Relay memory cap | 200 MB max · 80% CPU quota · auto-restart on failure |
| TLS | Let's Encrypt via certbot `--nginx`, auto-renews |

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Local SSH key + config](#2-local-ssh-key--config)
3. [Provision the DigitalOcean droplet](#3-provision-the-digitalocean-droplet)
4. [Reserved IP](#4-reserved-ip)
5. [Cloudflare DNS record](#5-cloudflare-dns-record)
6. [First SSH + baseline](#6-first-ssh--baseline)
7. [Swap + apt toolchain](#7-swap--apt-toolchain)
8. [Node 20 + pnpm](#8-node-20--pnpm)
9. [Non-root user + UFW](#9-non-root-user--ufw)
10. [Move SSH to port 222 + fail2ban permaban](#10-move-ssh-to-port-222--fail2ban-permaban)
11. [Sync the repo](#11-sync-the-repo)
12. [systemd unit + .env](#12-systemd-unit--env)
13. [nginx site config](#13-nginx-site-config)
14. [Build web-client with production env](#14-build-web-client-with-production-env)
15. [TLS via Let's Encrypt](#15-tls-via-lets-encrypt)
16. [End-to-end verification](#16-end-to-end-verification)
17. [Redeploy / push changes](#17-redeploy--push-changes)
18. [Operations reference](#18-operations-reference)
19. [Troubleshooting](#19-troubleshooting)

---

## 1. Prerequisites

On your local workstation:

- A DigitalOcean account with billing enabled.
- A Cloudflare account with **bbamorachi.us** already in it as a zone.
- `~/Documents/SITE_LATEST/tama-breed-poc/` checkout, buildable (`pnpm -r build` green).
- Local Node 20 + pnpm 9.15.0 (via `nvm` + `corepack`). Only needed for local builds + ws test client.
- `rsync`, `openssl`, `ssh`, `curl`, `dig` installed.

---

## 2. Local SSH key + config

Dedicated key per server limits blast radius.

```bash
# Generate a new ed25519 keypair
ssh-keygen -t ed25519 -C "playdate-droplet@bbamorachi" -f ~/.ssh/playdate_droplet
# Press Enter twice for no passphrase (or set one — both work)

# Print the public key; copy the whole line
cat ~/.ssh/playdate_droplet.pub
```

Add the public key to DigitalOcean: **Settings → Security → SSH keys → Add SSH
Key**. Name it `playdate-droplet`, paste the line, save.

Create the SSH shortcut so `ssh playdate` just works:

```bash
cat >> ~/.ssh/config <<'EOF'

Host playdate
    HostName 24.199.69.115
    User vic
    Port 222
    IdentityFile ~/.ssh/playdate_droplet
    IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
```

> **Note:** the config above is the *final* state. During initial setup the
> port will temporarily be `22` and user `root`; steps 6 and 10 walk through
> the transition.

---

## 3. Provision the DigitalOcean droplet

DO dashboard → **Create → Droplet**:

- **Image**: Ubuntu 24.04 (LTS) x64
- **Plan**: Basic · Regular · **$4/mo** (512 MB / 1 CPU / 10 GB)
- **Region**: pick closest to you. Keep this consistent — Reserved IPs are region-locked.
- **Authentication**: **SSH Key** → tick the box next to `playdate-droplet`. Uncheck any others.
- **Hostname**: `playdate-bbamorachi` (or anything memorable).
- **Finalize and create**.

Wait ~60–90 s for cloud-init to finish writing SSH keys before trying to connect.

---

## 4. Reserved IP

Decouples DNS from droplet lifecycle. Free while attached.

DO dashboard → **Networking → Reserved IPs → Assign Reserved IP**:

- **Data center region**: same as the droplet.
- **Assign to droplet**: the droplet you just made.
- Note the assigned IP (for this setup: `24.199.69.115`).

> If you ever destroy + recreate the droplet, reassign the same reserved IP so
> DNS stays valid: **Networking → Reserved IPs → (ip) → More → Reassign**.

---

## 5. Cloudflare DNS record

Cloudflare → `bbamorachi.us` zone → **DNS → Add record**:

- **Type**: A
- **Name**: `playdate`
- **IPv4 address**: `24.199.69.115` (your reserved IP)
- **Proxy status**: **DNS only (grey cloud)**
  - Orange proxy is fine for static HTTP, but Cloudflare Free's WebSocket
    behaviour on long-lived connections is inconsistent.
  - Certbot also needs direct access for its HTTP-01 challenge.
- **TTL**: Auto
- Save.

Verify propagation (~30–60 s):

```bash
dig +short playdate.bbamorachi.us @1.1.1.1
# Expected: 24.199.69.115
```

---

## 6. First SSH + baseline

At this point the droplet has root + your SSH key, listening on port 22.

**Temporarily edit `~/.ssh/config`** so first connections work as root on :22:

```bash
sed -i 's/User vic/User root/; s/Port 222/Port 22/' ~/.ssh/config
```

Connect and get baseline info:

```bash
ssh -o StrictHostKeyChecking=accept-new playdate 'uname -a; echo; free -h; echo; df -h /; echo; cat /etc/os-release | head -3'
```

Expected shape:

```
Linux ubuntu-... #... Ubuntu SMP ... x86_64 GNU/Linux
Mem: 458Mi total, 272Mi available, 0B Swap     <-- no swap yet, fix in step 7
/dev/vda1   8.7G  2.0G  6.8G  23%  /
PRETTY_NAME="Ubuntu 24.04.3 LTS"
```

---

## 7. Swap + apt toolchain

On a 512 MB droplet, skipping swap causes `pnpm install` OOMs. 2 GB is standard.

```bash
ssh playdate 'set -e

# 2GB swap file
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
  sysctl vm.swappiness=10
  echo "vm.swappiness=10" >> /etc/sysctl.conf
fi
free -h

# apt update + upgrade
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"

# base toolchain
apt-get install -y -qq nginx certbot python3-certbot-nginx fail2ban ufw git build-essential curl ca-certificates
'
```

---

## 8. Node 20 + pnpm

```bash
ssh playdate 'set -e
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y -qq nodejs
corepack enable
corepack prepare pnpm@9.15.0 --activate
node -v && pnpm -v
'
```

Expected: `v20.20.2` and `9.15.0`.

---

## 9. Non-root user + UFW

Create the daily-driver user, copy the SSH key, enable firewall.

```bash
ssh playdate 'set -e

# 1. Non-root user with passwordless sudo
if ! id vic >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" vic
  usermod -aG sudo vic
  echo "vic ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/vic
  chmod 440 /etc/sudoers.d/vic
fi

# 2. Copy root key to vic
mkdir -p /home/vic/.ssh
cp /root/.ssh/authorized_keys /home/vic/.ssh/authorized_keys
chown -R vic:vic /home/vic/.ssh
chmod 700 /home/vic/.ssh
chmod 600 /home/vic/.ssh/authorized_keys

# 3. UFW: allow SSH before enabling (do not lock out)
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment "ssh"
ufw allow 80/tcp comment "http"
ufw allow 443/tcp comment "https"
ufw --force enable
ufw status verbose
'
```

**Verify vic login works BEFORE moving to step 10:**

```bash
ssh -l vic -p 22 playdate 'whoami && sudo whoami'
# Expected: vic\nroot
```

---

## 10. Move SSH to port 222 + fail2ban permaban

Ubuntu 24.04 uses `ssh.socket` (systemd socket activation) which overrides the
`Port` directive in `sshd_config`. We disable socket activation so our port
override actually takes effect.

```bash
ssh playdate 'sudo bash -s' <<'REMOTE'
set -e

# Hardening override
cat > /etc/ssh/sshd_config.d/99-playdate-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
ChallengeResponseAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
Port 222
EOF

# Disable socket activation, use service-based sshd
systemctl disable --now ssh.socket
systemctl enable --now ssh
systemctl restart ssh

# Open 222, close 22, rate-limit 222
ufw allow 222/tcp comment "ssh-custom"
ufw delete allow 22/tcp || true
ufw --force delete allow 222/tcp 2>/dev/null || true
# limit = max 6 new connections / 30 s per IP
ufw limit 222/tcp comment "ssh rate-limited"

# Fail2ban: 1 failed auth = permaban (pubkey-only means any failure is foul play)
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
port    = 222
maxretry = 1
findtime = 600
bantime  = -1
EOF
systemctl restart fail2ban
fail2ban-client status sshd
REMOTE
```

Now update your local SSH config to point at the new port + user:

```bash
sed -i 's/User root/User vic/; s/Port 22$/Port 222/' ~/.ssh/config
```

Verify:

```bash
ssh playdate 'whoami && hostname && echo OK'
# Expected: vic\nubuntu-... \nOK
```

> **Warning — don't ban yourself.** With `bantime = -1` + `maxretry = 1`, a
> single failed auth (e.g. SSHing from a new machine that doesn't have the key)
> gets your IP permanently banned. Always copy `~/.ssh/playdate_droplet` before
> first SSH from a new client. To unban from the server:
> `sudo fail2ban-client unban <ip>`.

---

## 11. Sync the repo

From your local workstation:

```bash
# Create /srv/playdate owned by vic
ssh playdate 'sudo mkdir -p /srv/playdate && sudo chown vic:vic /srv/playdate'

# Push the tree (exclude node_modules, dist, local data, git internals)
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .git/ --exclude 'relay-server/data' \
  -e 'ssh' \
  /home/vic/Documents/SITE_LATEST/tama-breed-poc/ playdate:/srv/playdate/

# Install deps + build on the droplet
ssh playdate 'cd /srv/playdate && pnpm install --frozen-lockfile && pnpm -r build'
```

---

## 12. systemd unit + .env

Creates the service unit, generates a fresh shared secret, starts + enables.

```bash
ssh playdate 'sudo bash -s' <<'REMOTE'
set -e

# systemd unit
cat > /etc/systemd/system/playdate-relay.service <<'EOF'
[Unit]
Description=Playdate Relay (Paradise ghost-exchange WebSocket relay)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=vic
Group=vic
WorkingDirectory=/srv/playdate/relay-server
EnvironmentFile=/srv/playdate/relay-server/.env
# Using tsx so ESM + TS runs without emit-level extension fixup.
ExecStart=/srv/playdate/relay-server/node_modules/.bin/tsx /srv/playdate/relay-server/src/index.ts
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/playdate/relay-server/data
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LockPersonality=true
MemoryDenyWriteExecute=false
# 512 MB droplet: cap resource usage so a runaway relay can't nuke the box
MemoryMax=200M
CPUQuota=80%

[Install]
WantedBy=multi-user.target
EOF

# Data dir for sqlite
mkdir -p /srv/playdate/relay-server/data
chown vic:vic /srv/playdate/relay-server/data

# Generate and persist the shared secret (64 hex chars = 32 bytes entropy)
if [ ! -f /srv/playdate/relay-server/.env ]; then
  SECRET=$(openssl rand -hex 32)
  cat > /srv/playdate/relay-server/.env <<EOF
PORT=3001
SHARED_SECRET=$SECRET
DB_PATH=/srv/playdate/relay-server/data/sessions.db
SESSION_TTL_MS=600000
EOF
  chown vic:vic /srv/playdate/relay-server/.env
  chmod 640 /srv/playdate/relay-server/.env
fi

# Start + enable on boot
systemctl daemon-reload
systemctl enable --now playdate-relay
sleep 3
systemctl status playdate-relay --no-pager | head -12
curl -sS http://127.0.0.1:3001/health
REMOTE
```

Expected last line: `{"ok":true}`.

---

## 13. nginx site config

Single subdomain · both static files AND WebSocket proxy on one server block.

```bash
ssh playdate 'sudo bash -s' <<'REMOTE'
set -e

cat > /etc/nginx/sites-available/playdate <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name playdate.bbamorachi.us;

    # ACME HTTP-01 challenge
    location /.well-known/acme-challenge/ { root /var/www/certbot; }

    # Static web-client
    root /srv/playdate/web-client/dist;
    index index.html;

    # Relay endpoints -> Node on :3001 with WebSocket upgrade
    location ~ ^/(ws/|sessions|health) {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Asset caching (Vite hashes filenames)
    location ~* \.(?:js|css|png|ttf|woff2?|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }
}
EOF

mkdir -p /var/www/certbot
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/playdate /etc/nginx/sites-enabled/playdate
nginx -t
systemctl reload nginx
REMOTE
```

---

## 14. Build web-client with production env

Vite bakes `VITE_*` env vars into the bundle at build time, so we must rebuild
whenever the URL or shared secret changes.

```bash
ssh playdate 'bash -s' <<'REMOTE'
set -e
RELAY_SECRET=$(grep '^SHARED_SECRET=' /srv/playdate/relay-server/.env | cut -d= -f2-)
cd /srv/playdate/web-client
export VITE_RELAY_URL=https://playdate.bbamorachi.us
export VITE_RELAY_SECRET="$RELAY_SECRET"
pnpm build
ls -lh dist
REMOTE
```

---

## 15. TLS via Let's Encrypt

Certbot edits the nginx site in place, adds HSTS, and sets up auto-renew.

```bash
ssh playdate 'sudo certbot --nginx -d playdate.bbamorachi.us \
  --non-interactive --agree-tos \
  --email vic@unexists.com \
  --redirect'
```

Certbot installs a systemd timer for auto-renewal — no cron entry needed. Verify:

```bash
ssh playdate 'sudo systemctl list-timers | grep certbot'
```

---

## 16. End-to-end verification

### HTTPS + redirect

```bash
curl -sS https://playdate.bbamorachi.us/health
# {"ok":true}

curl -sI http://playdate.bbamorachi.us/health | head -2
# HTTP/1.1 301 Moved Permanently
# Location: https://playdate.bbamorachi.us/health
```

### POST a session

```bash
SECRET=$(ssh playdate 'grep SHARED_SECRET /srv/playdate/relay-server/.env | cut -d= -f2-')
curl -sS -X POST https://playdate.bbamorachi.us/sessions -H "x-poc-secret: $SECRET"
# {"code":"ABC123","ttlMs":600000}
```

### WebSocket round-trip

Local Node test — same thing the browser does from the UI:

```bash
export SECRET=$(ssh playdate 'grep SHARED_SECRET /srv/playdate/relay-server/.env | cut -d= -f2-')
node -e "
const WS = require('ws');
const secret = process.env.SECRET;
const { execSync } = require('child_process');
const { code } = JSON.parse(execSync('curl -sS -X POST https://playdate.bbamorachi.us/sessions -H \"x-poc-secret: ' + secret + '\"').toString());
const a = new WS('wss://playdate.bbamorachi.us/ws/' + code + '?role=a&secret=' + secret);
const b = new WS('wss://playdate.bbamorachi.us/ws/' + code + '?role=b&secret=' + secret);
Promise.all([new Promise(r=>a.once('open',r)), new Promise(r=>b.once('open',r))]).then(async ()=>{
  console.log('WSS open on both');
  const gotB = new Promise(r=>b.once('message',r));
  a.send(Buffer.from([0xde,0xad,0xbe,0xef]));
  console.log('a->b:', Buffer.from(await gotB).toString('hex'));
  process.exit(0);
});
"
# Expected: a->b: deadbeef
```

### Browser

Load **https://playdate.bbamorachi.us** in Chrome/Edge. The Paradise Link UI
should load. Two tabs · Create Room / Join Room → PAIRED → exchange.

---

## 17. Redeploy / push changes

### Auth topology (reference)

```
Your laptop                  GitHub                    Droplet (/srv/playdate)
───────────                  ──────                    ────────
git push (HTTPS + PAT)  ────►  repo  ◄──── git pull (SSH, deploy key)
                               │
                               └─ deploy key (read-only, per-repo)
ssh playdate (SSH key) ────────────────────────────►  ssh daemon
```

| Connection | Method | Credential |
|---|---|---|
| Your laptop → droplet SSH | SSH | `~/.ssh/playdate_droplet` (private) |
| Droplet → GitHub (pulls) | SSH | `~/.ssh/github_deploy` on droplet, public added as the repo's **deploy key** |
| Your laptop → GitHub (push) | HTTPS | Classic **PAT** with `repo` scope |

You don't need any more SSH setup. Droplet-side SSH is permanent;
GitHub-write from your laptop is PAT only.

### Stash the PAT so `git push` is silent

```bash
git config --global credential.helper store
```

Next `git push` prompts you once:

```
Username for 'https://github.com': victorfeight
Password for 'https://victorfeight@github.com': <paste PAT>
```

Git writes `~/.git-credentials` (plaintext; on your own machine this is fine
for a `repo`-scope PAT). After that, every `git push` is silent.

More secure alternative (Gnome Keyring-backed on Debian):

```bash
sudo apt install -y libsecret-1-0 libsecret-1-dev
sudo make -C /usr/share/doc/git/contrib/credential/libsecret
git config --global credential.helper \
  /usr/share/doc/git/contrib/credential/libsecret/git-credential-libsecret
```

### PAT hygiene

- Any PAT that touches a chat window, Slack, email, screenshot, or anything
  that stores to disk outside your password manager → **revoke and rotate**.
  GitHub → avatar → **Settings → Developer settings → Personal access tokens →
  Tokens (classic)** → Delete the old one, Generate new one (`repo` scope,
  90-day expiry), update `~/.git-credentials` (or the next push will reprompt).

### Git-pull workflow (current, preferred)

`/srv/playdate` is a git checkout of **github.com/victorfeight/tama-playdata-poc**,
authenticated via a GitHub **deploy key** (read-only) at `~/.ssh/github_deploy`
on the droplet. Deploys are `git push` locally, `git pull` + rebuild + restart
on the droplet.

**Local — commit and push as usual:**

```bash
cd /home/vic/Documents/SITE_LATEST/tama-breed-poc
git add -A && git commit -m "<msg>"
git push origin main
```

**Droplet — pull + rebuild + restart (full):**

```bash
ssh playdate 'set -e
cd /srv/playdate
git pull
pnpm install --frozen-lockfile
# tama-protocol must build first so its .d.ts exists for web-client TS to compile
pnpm --filter @tama-breed-poc/tama-protocol build
RELAY_SECRET=$(grep ^SHARED_SECRET= relay-server/.env | cut -d= -f2-)
VITE_RELAY_URL=https://playdate.bbamorachi.us \
VITE_RELAY_SECRET=$RELAY_SECRET \
pnpm --filter @tama-breed-poc/web-client build
sudo systemctl restart playdate-relay
sleep 2
curl -sS http://127.0.0.1:3001/health
'
```

**Relay-only hot restart** (no code change, just bounce the process):

```bash
ssh playdate 'sudo systemctl restart playdate-relay && \
  sleep 2 && systemctl status playdate-relay --no-pager | head -5'
```

**Web-client-only rebuild** (no relay restart — nginx serves static files live):

```bash
ssh playdate 'set -e
cd /srv/playdate
git pull
pnpm --filter @tama-breed-poc/tama-protocol build
RELAY_SECRET=$(grep ^SHARED_SECRET= relay-server/.env | cut -d= -f2-)
VITE_RELAY_URL=https://playdate.bbamorachi.us \
VITE_RELAY_SECRET=$RELAY_SECRET \
pnpm --filter @tama-breed-poc/web-client build
'
```

### One-time deploy-key setup (reference — already done on this droplet)

If you ever recreate the droplet, this is the sequence that wires `git pull`
to GitHub without any password / PAT on the box:

```bash
ssh playdate '
# Generate a read-only key pair for GitHub (no passphrase so systemd-era pulls work)
ssh-keygen -t ed25519 -C "playdate-droplet deploy key" -f ~/.ssh/github_deploy -N ""

# Route git@github.com through this key
cat > ~/.ssh/config <<EOF
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/github_deploy
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
EOF
chmod 600 ~/.ssh/config

cat ~/.ssh/github_deploy.pub
'
```

Copy the printed public key, then in GitHub:

1. Go to **github.com/victorfeight/tama-playdata-poc → Settings → Deploy keys**
2. Click **Add deploy key**
3. Title: `playdate-droplet`
4. Key: paste the line from above
5. **Leave "Allow write access" UNCHECKED**
6. Add key.

Test with:

```bash
ssh playdate 'ssh -T git@github.com'
# Expected: "Hi victorfeight! You've successfully authenticated..."
```

Then clone into `/srv/playdate`:

```bash
ssh playdate '
sudo mkdir -p /srv/playdate
sudo chown vic:vic /srv/playdate
sudo -u vic git clone git@github.com:victorfeight/tama-playdata-poc.git /tmp/playdate-clone
sudo -u vic bash -c "shopt -s dotglob; mv /tmp/playdate-clone/* /srv/playdate/"
rm -rf /tmp/playdate-clone
# Restore .env + data from backup if applicable (or regenerate via §12)
'
```

### Legacy rsync workflow (fallback)

Keep in back pocket in case GitHub is down or the deploy key is revoked.
Still works because nothing on the droplet depends on the repo being a git
checkout at runtime — only at deploy time.

```bash
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .git/ --exclude 'relay-server/data' \
  -e 'ssh' . playdate:/srv/playdate/

ssh playdate 'cd /srv/playdate && pnpm install --frozen-lockfile && \
  pnpm --filter @tama-breed-poc/tama-protocol build && \
  RELAY_SECRET=$(grep ^SHARED_SECRET= relay-server/.env | cut -d= -f2-) \
  VITE_RELAY_URL=https://playdate.bbamorachi.us VITE_RELAY_SECRET=$RELAY_SECRET \
  pnpm --filter @tama-breed-poc/web-client build && \
  sudo systemctl restart playdate-relay'
```

---

## 18. Operations reference

| Action | Command |
|---|---|
| Tail relay logs | `ssh playdate 'sudo journalctl -u playdate-relay -f'` |
| Restart relay | `ssh playdate 'sudo systemctl restart playdate-relay'` |
| Check relay status | `ssh playdate 'sudo systemctl status playdate-relay'` |
| Relay memory + cpu | `ssh playdate 'systemctl show playdate-relay -p MemoryCurrent,CPUUsageNSec'` |
| Reload nginx (config change) | `ssh playdate 'sudo nginx -t && sudo systemctl reload nginx'` |
| Tail nginx access | `ssh playdate 'sudo tail -f /var/log/nginx/access.log'` |
| Tail nginx errors | `ssh playdate 'sudo tail -f /var/log/nginx/error.log'` |
| Currently banned IPs | `ssh playdate 'sudo fail2ban-client status sshd'` |
| Unban an IP | `ssh playdate 'sudo fail2ban-client unban <ip>'` |
| UFW status | `ssh playdate 'sudo ufw status verbose'` |
| Manual cert renewal test | `ssh playdate 'sudo certbot renew --dry-run'` |
| Certbot renewal timer | `ssh playdate 'sudo systemctl list-timers \| grep certbot'` |
| Swap usage | `ssh playdate 'free -h'` |
| Disk usage | `ssh playdate 'df -h /'` |
| Rotate SHARED_SECRET | edit `/srv/playdate/relay-server/.env`, rebuild web-client (§17 web-client-only), restart relay |
| Inspect sessions db | `ssh playdate 'sudo -u vic sqlite3 /srv/playdate/relay-server/data/sessions.db "SELECT * FROM sessions ORDER BY created_at DESC LIMIT 10;"'` |
| DB size | `ssh playdate 'ls -lh /srv/playdate/relay-server/data/sessions.db'` |

---

## 19. Troubleshooting

### `ssh playdate` → Connection reset at kex

Cloud-init still running, or socket activation is in a weird state.
Check state via the DigitalOcean web console (droplet page → **Access** →
**Launch Droplet Console**). If the droplet is at a login prompt there but SSH
fails, run `sudo systemctl status ssh` and `sudo journalctl -u ssh -n 30`. Most
common cause: first boot not done — wait 90 s.

### `ssh playdate` → Permission denied

You're using the wrong key, or your IP got fail2banned.

```bash
# Verify your local config
cat ~/.ssh/config

# From the droplet web console:
sudo fail2ban-client status sshd
# If your IP is in the banned list:
sudo fail2ban-client unban <your-ip>
```

### `systemctl status playdate-relay` → Active: failed

```bash
ssh playdate 'sudo journalctl -u playdate-relay -n 60 --no-pager'
```

Common causes:
- `.env` missing or wrong perms → `ls -la /srv/playdate/relay-server/.env` (should be `vic:vic`, `0640`).
- tsx not installed → `cd /srv/playdate && pnpm install --frozen-lockfile`.
- Port 3001 already bound → `sudo ss -tlnp | grep 3001`.

### `curl https://playdate.bbamorachi.us/health` → 502 Bad Gateway

Relay is down but nginx is up. `ssh playdate 'sudo systemctl restart playdate-relay'`.

### Certbot fails with HTTP-01 challenge

- DNS not propagated yet → `dig +short playdate.bbamorachi.us`. Wait if empty.
- Cloudflare proxy is on (orange cloud) → switch to grey cloud for cert issuance, can flip back after.
- Port 80 closed in UFW → `sudo ufw status | grep 80`.

### WebSocket connects but immediately closes (code 1006)

Cloudflare proxy (orange cloud) is closing idle WebSockets after 100 s. Either:
- Switch the DNS record to grey cloud (DNS only), OR
- Add a heartbeat/ping in the client — the relay already pings every 25 s server-side.

### Out of memory / OOMKiller logs

```bash
ssh playdate 'dmesg | grep -i "killed process" | tail'
```

Relay is capped at 200 MB by the systemd unit. If you see OOM kills repeatedly,
either increase `MemoryMax` in `/etc/systemd/system/playdate-relay.service`
(and `systemctl daemon-reload && restart`), or upgrade the droplet to 1 GB.

### Sessions not persisting across restart

```bash
ssh playdate 'ls -la /srv/playdate/relay-server/data/'
```

If `sessions.db` is missing or owned by root, the systemd unit's
`ReadWritePaths` is denying writes. Fix:

```bash
ssh playdate '
sudo mkdir -p /srv/playdate/relay-server/data
sudo chown -R vic:vic /srv/playdate/relay-server/data
sudo systemctl restart playdate-relay
'
```

### DNS resolves but browser shows `ERR_CERT_*`

Grey cloud at Cloudflare + certbot-nginx should Just Work. If not:

```bash
ssh playdate 'sudo certbot certificates'
# Verify "Domains: playdate.bbamorachi.us" and a valid expiry.
# If expired or missing:
ssh playdate 'sudo certbot --nginx -d playdate.bbamorachi.us'
```

---

## Appendix: Recreating the droplet from scratch

If you need to destroy + rebuild (e.g. OS upgrade, suspected compromise):

1. Back up the session db: `scp playdate:/srv/playdate/relay-server/data/sessions.db ./backup-$(date +%F).db`
2. **DO dashboard**: your droplet → **Destroy** tab → confirm.
3. The reserved IP stays (still free while you have a new droplet in <7 days).
4. Create a new droplet (§3), same region.
5. Reassign the reserved IP (§4).
6. Run §7 through §15 again. DNS (§5) is already there.
7. Restore `sessions.db` if you want session continuity (rare; 10-min TTL makes it mostly moot).

Total time from destroy to green: ~15 min if you paste these steps verbatim.
