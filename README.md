# Hetzner MCP Server

Verbindet Claude.ai mit einem Linux-Server via ngrok-Tunnel.
Claude kann dann Shell-Commands ausführen und den Rest der Installation selbst erledigen.

---

## Schritt 1 — Frischer Server: Nur SSH-Zugang nötig

```bash
ssh root@<SERVER-IP>
```

Danach Claude in diesem Chat beauftragen:

> "Ich habe einen neuen Hetzner Server unter IP x.x.x.x.
>  Bitte richte alles ein damit du dich als MCP Server verbinden kannst."

Claude erledigt dann automatisch:
- User anlegen
- Node.js installieren
- ngrok installieren + konfigurieren
- Diesen MCP Server deployen
- nginx Router einrichten
- systemd Services einrichten
- Claude.ai Connector URL ausgeben

---

## Schritt 2 — Claude.ai Connector einrichten

Sobald Claude die URL ausgibt (Format: `https://xxxx.ngrok-free.dev/hetzner/mcp`):

1. Claude.ai → Settings → Integrations → Add Integration
2. Name: `Hetzner MCP`
3. URL eintragen
4. Speichern → im Chat aktivieren

---

## Was dieser Server macht

Ein einziges MCP-Tool `exec` — Claude kann damit beliebige Shell-Commands
auf dem Server ausführen. Der Rest (Tradeblocks, Playwright, Taskmaster etc.)
wird danach von Claude selbst installiert.

**Sicherheit:** Kein Auth nötig solange nur du den ngrok-Link kennst.

---

## Empfohlene Verzeichnisstruktur (Claude richtet ein)

```
~/server/        ← MCP Server + Doku + nginx/ngrok Config
~/tools/         ← Projekt-spezifische Tools
~/backtests/     ← Backtest-Ergebnisse
~/rag/           ← RAG Systeme
~/research/      ← Analyse-Ergebnisse
~/code/          ← Temporäre Entwicklungs-Projekte
```
