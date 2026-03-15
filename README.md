# Hetzner MCP Server

Ermöglicht Claude.ai Shell-Commands auf einem Linux-Server auszuführen.

## Wie funktioniert das?

```
Claude.ai Chat
    │  (MCP Connector)
    ▼
ngrok Tunnel (öffentliche URL)
    │
    ▼
Dieser MCP Server (läuft dauerhaft auf dem Server)
    │  (exec Tool)
    ▼
Shell → alles was man im Terminal machen würde
```

Claude verbindet sich **nicht per SSH**. Der MCP Server läuft als
systemd Service auf dem Server und wartet auf Anfragen von Claude.
Einmal eingerichtet braucht man keinen Terminal mehr — Claude erledigt alles.

---

## Einmalige Erstinstallation (nur beim ersten Mal)

Da beim frischen Server noch kein MCP Server läuft, braucht man
**einmalig** einen Terminal (z.B. Blink auf iOS oder ein SSH Client):

```bash
ssh root@<SERVER-IP>

# Node.js installieren
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git

# MCP Server installieren
mkdir -p /home/carsten/server/mcp-server
cd /home/carsten/server/mcp-server
git clone https://github.com/carstenf/hetzner-mcp-server.git .
npm install

# Als Service starten
cat > /etc/systemd/system/mcp-server.service << 'SVCEOF'
[Unit]
Description=MCP Server
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

Dann ngrok einrichten und die URL in Claude.ai als Connector eintragen.
**Ab diesem Moment übernimmt Claude alles weitere** — nginx, User, 
weitere Services, Verzeichnisstruktur etc.

---

## Claude.ai Connector einrichten

1. Claude.ai → Settings → Integrations → Add Integration
2. Name: `Hetzner MCP`
3. URL: `https://<NGROK-DOMAIN>/hetzner/mcp`
4. Aktivieren → fertig

