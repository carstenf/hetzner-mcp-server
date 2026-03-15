# Hetzner MCP Server

Allows Claude.ai to execute shell commands on a Linux server via ngrok tunnel.

## How it works

```
Claude.ai Chat
    │  (MCP Connector)
    ▼
ngrok Tunnel (public URL)
    │
    ▼
This MCP Server (runs as a permanent systemd service)
    │  (exec tool)
    ▼
Shell — anything you'd do in a terminal
```

Claude does **not** connect via SSH. The MCP Server runs as a systemd service
on the server and waits for requests from Claude.
Once set up, you never need a terminal again — Claude handles everything.

---

## One-time Setup (fresh server only)

Since no MCP Server is running yet on a fresh server, you need a terminal
**once** (e.g. Blink on iOS or any SSH client):

```bash
ssh root@<SERVER-IP>

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git

# Install MCP Server
mkdir -p /home/carsten/server/mcp-server
cd /home/carsten/server/mcp-server
git clone https://github.com/carstenf/hetzner-mcp-server.git .
npm install

# Run as systemd service
cat > /etc/systemd/system/mcp-server.service << 'SVCEOF'
[Unit]
Description=Hetzner MCP Server
After=network.target
[Service]
Type=simple
User=root
WorkingDirectory=/home/carsten/server/mcp-server
ExecStart=/usr/bin/node server.js
Restart=always
[Install]
WantedBy=multi-user.target
SVCEOF

systemctl enable --now mcp-server
```

Then set up ngrok and add the URL to Claude.ai as a connector.
**From this point Claude handles everything else** — nginx, users,
additional services, directory structure, etc.

---

## Add Claude.ai Connector

1. Claude.ai → Settings → Integrations → Add Integration
2. Name: `Hetzner MCP`
3. URL: `https://<NGROK-DOMAIN>/hetzner/mcp`
4. Save and enable in chat

---

## Recommended directory structure (Claude sets this up)

```
~/server/        ← MCP server + docs + nginx/ngrok config
~/tools/         ← Project-specific tools
~/backtests/     ← Backtest results
~/rag/           ← RAG systems
~/research/      ← Analysis results
~/code/          ← Temporary development projects
```
