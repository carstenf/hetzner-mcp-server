# Hetzner MCP Server

Ein minimaler MCP (Model Context Protocol) Server der Claude.ai erlaubt Shell-Commands auf einem Linux-Server auszuführen.

## Was ist das?

Dieser Server stellt ein einziges MCP-Tool `exec` bereit — damit kann Claude direkt Befehle auf deinem Server ausführen, Dateien lesen/schreiben, Services verwalten etc.

**Sicherheitshinweis:** Nur für vertrauenswürdige Umgebungen. Der Server hat keine Authentifizierung — Absicherung erfolgt via ngrok-Tunnel.

---

## Voraussetzungen

- Ubuntu 22.04 / 24.04 Server (z.B. Hetzner CX22)
- Root-Zugang via SSH
- ngrok Account (kostenlos, für feste Domain ngrok paid)
- Claude.ai Pro/Team Account

---

## Installation (frischer Server)

### 1. SSH-Verbindung

```bash
ssh root@<SERVER-IP>
```

### 2. System updaten + Node.js installieren

```bash
apt update && apt upgrade -y
apt install -y curl git nginx

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node --version  # sollte v20.x zeigen
```

### 3. User anlegen

```bash
adduser carsten
usermod -aG sudo carsten
su - carsten
```

### 4. ngrok installieren

```bash
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update && sudo apt install ngrok

# Auth Token eintragen (aus ngrok Dashboard)
ngrok config add-authtoken <DEIN_NGROK_TOKEN>
```

ngrok Config (`~/.config/ngrok/ngrok.yml`):
```yaml
version: "3"
agent:
  authtoken: <DEIN_NGROK_TOKEN>

tunnels:
  combined:
    proto: http
    addr: 3200
    domain: <DEINE_NGROK_DOMAIN>  # z.B. mein-server.ngrok-free.dev
```

### 5. MCP Server installieren

```bash
mkdir -p ~/server/mcp-server
cd ~/server/mcp-server
git clone https://github.com/carstenf/hetzner-mcp-server.git .
npm install
```

### 6. systemd Service einrichten

```bash
sudo tee /etc/systemd/system/mcp-server.service > /dev/null <<EOF
[Unit]
Description=MCP Server with Hetzner SSH
After=network.target

[Service]
Type=simple
User=carsten
WorkingDirectory=/home/carsten/server/mcp-server
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable mcp-server
sudo systemctl start mcp-server
systemctl status mcp-server
```

### 7. nginx Router einrichten

```bash
sudo tee /etc/nginx/sites-available/mcp-router.conf > /dev/null <<EOF
server {
    listen 3200;

    location /hetzner/ {
        proxy_pass http://localhost:3000/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/mcp-router.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx
```

### 8. ngrok Service einrichten

```bash
sudo tee /etc/systemd/system/ngrok.service > /dev/null <<EOF
[Unit]
Description=ngrok tunnel
After=network.target

[Service]
Type=simple
User=carsten
ExecStart=/usr/bin/ngrok start --all --config /home/carsten/.config/ngrok/ngrok.yml
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ngrok
sudo systemctl start ngrok
```

### 9. Testen

```bash
# Lokal
curl http://localhost:3000/

# Via ngrok
curl https://<DEINE_DOMAIN>/hetzner/
```

---

## Claude.ai Connector einrichten

1. Claude.ai → Settings → Integrations → Add Integration
2. Name: `Hetzner MCP`
3. URL: `https://<DEINE_NGROK_DOMAIN>/hetzner/mcp`
4. Speichern und im Chat aktivieren

---

## Weitere MCP Server hinzufügen

Die nginx Config kann beliebig viele MCP Server routen:

```nginx
location /tradeblocks/ { proxy_pass http://localhost:3100/; }
location /taskmaster/  { proxy_pass http://localhost:3300/; }
location /playwright/  { proxy_pass http://localhost:3400/; }
```

---

## Verzeichnisstruktur (empfohlen)

```
/home/carsten/
  server/
    mcp-server/        ← dieser Repo
    docs/              ← Architekturdoku
    bin/               ← mosh-server-wrapper etc.
    skills/            ← Claude Skills
  tools/               ← projekt-spezifische Tools
  backtests/           ← Backtest-Ergebnisse
  rag/                 ← RAG Systeme
  research/            ← Analyse-Ergebnisse
  code/                ← temporäre Entwicklungs-Projekte
```

