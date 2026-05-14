# mcp-server

A Model Context Protocol (MCP) server exposing six tools to a connected agent:

| Tool | What it does |
|---|---|
| `exec` | Run a shell command. |
| `write_file` | Write a file as the MCP service user (base64-encoded content). |
| `write_file_sudo` | Atomically write a system file requiring root. Stages to `/tmp`, then `sudo cp` + `chown` + `chmod`. |
| `read_file` | Read a file. Optional `start_line` / `end_line` returns a slice with 1-indexed line-number prefixes (display-only). |
| `stat_file` | Metadata + optional sha256. |
| `str_replace` | Replace one unique substring in a text file. Fails if `old_str` is missing or non-unique. `sudo=true` writes back via `/tmp` + `sudo cp`. |

The transport is StreamableHTTP on a configurable port. The MCP SDK version is `^1.29.0`.

## Why these tools

The earlier version of this server exposed only `exec`, `write_file`, `read_file`, `stat_file`. An AI agent editing files through that toolset had to base64-rewrite the entire file for every change, and `sudo` operations took three round-trips (`write_file /tmp/X` → `exec sudo cp` → `exec sudo chown`). v2 adds `str_replace` (sends only the diff) and `write_file_sudo` (one round-trip for the full staged-write pattern), and gives `read_file` a `start_line` / `end_line` slice mode. The result: noticeably fewer tokens and round-trips per edit.

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `MCP_PORT` | `3001` | HTTP port. |
| `MCP_SERVER_NAME` | `mcp-server` | Advertised server name. Use this to distinguish multiple deployments. |
| `MCP_SUDO_PASSWORD` | *(empty — disables sudo tools)* | Fed to `sudo -S` for `write_file_sudo` and `str_replace` with `sudo=true`. |
| `MCP_WORK_CWD` | `/home/carsten` | Default cwd for `exec`. |
| `MCP_EXEC_TIMEOUT_MS` | `60000` | Default per-command timeout. |
| `MCP_EXEC_MAX_BUFFER` | `52428800` | Max stdout/stderr buffer for `exec`. |

If `MCP_SUDO_PASSWORD` is unset, `write_file_sudo` and `str_replace` with `sudo=true` return a clear error rather than attempting a privileged operation.

## Run locally

```bash
npm install
MCP_SUDO_PASSWORD='...' node server.js
# → listening on :3001
```

## Endpoints

- `POST /mcp` — MCP StreamableHTTP transport
- `GET /mcp`, `DELETE /mcp` — session management
- `GET /health` — JSON: `{name, version, port, sudo_enabled}`

## Deployment

This repository is the single source of truth for two deployments:

- **Hetzner (public)** — `MCP_SERVER_NAME=hetzner-mcp`, reachable behind Caddy + OAuth on `mcp.carstenfreek.de`.
- **Lenovo1 (internal)** — `MCP_SERVER_NAME=lenovo1-mcp`, reachable on the WireGuard interface (`10.0.0.2:3001`).

Both run from the same code; they differ only in the environment variables and the systemd unit pointing at the right working directory.

Example systemd unit:

```ini
[Unit]
Description=MCP Server
After=network.target

[Service]
Type=simple
User=carsten
WorkingDirectory=/home/carsten/mcp-server
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=MCP_PORT=3001
Environment=MCP_SERVER_NAME=lenovo1-mcp
EnvironmentFile=/etc/mcp-server/secret.env   # for MCP_SUDO_PASSWORD; root-owned 0640

[Install]
WantedBy=multi-user.target
```

## Security notes

- `MCP_SUDO_PASSWORD` should only be loaded via systemd's `EnvironmentFile=` from a root-owned `0640` file. Never pass it as a tool argument; never log it.
- The service should bind on a private interface (WireGuard) or sit behind a reverse proxy with authentication when run on a public host. `exec` and `write_file_sudo` would otherwise be a wide-open shell.
- `str_replace` requires unique matches and refuses ambiguous patterns. It mirrors the contract of the sandbox `str_replace` tool.

## License

MIT
