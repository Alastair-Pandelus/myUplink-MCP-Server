# myUplink MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that connects Claude (or any MCP client) to your **NIBE myUplink** heat-pump account.

## Features

| Tool | What it does |
|------|-------------|
| `get_authorization_url` | Generate the OAuth2 login URL |
| `exchange_auth_code` | Trade a one-time code for access + refresh tokens |
| `authenticate_client_credentials` | Server-to-server auth (no browser required) |
| `get_systems` | List all heat-pump systems in the account |
| `get_system` | Detail view of a single system |
| `get_device` | Firmware version, connection state, serial number |
| `get_device_points` | Read any/all sensor & setting values |
| `set_device_points` | Write new values (requires Premium + WRITESYSTEM scope) |
| `get_common_parameters` | Quick view of the most useful readings |
| `get_alarms` | Active alarms / notifications |
| `get_smart_home_zones` | Smart-home climate zones |

## Prerequisites

* Node.js 18+
* A myUplink account with at least one connected device
* An OAuth2 application created at <https://dev.myuplink.com/apps>

## Setup

```bash
git clone <this-repo>
cd myuplink-mcp
npm install
cp .env.example .env
# Edit .env – add your CLIENT_ID and CLIENT_SECRET
npm run build
```

## Running the server

```bash
npm start
# or during development:
npm run dev
```

## Claude Desktop integration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "myuplink": {
      "command": "node",
      "args": ["/absolute/path/to/myuplink-mcp/dist/index.js"],
      "env": {
        "MYUPLINK_CLIENT_ID": "your_client_id",
        "MYUPLINK_CLIENT_SECRET": "your_client_secret",
        "MYUPLINK_REFRESH_TOKEN": "optional_saved_refresh_token"
      }
    }
  }
}
```

## First-time authentication (Authorization Code flow)

1. Call `get_authorization_url` → open the URL in a browser
2. Log in and approve the scopes
3. Copy the `code=…` value from the redirect URL
4. Call `exchange_auth_code` with that code
5. From now on the server auto-refreshes tokens using the refresh token

### No-browser alternative (Client Credentials)

If your myUplink application supports it, call `authenticate_client_credentials` – no browser needed, but only your own account data is accessible.

## Common myUplink parameter IDs

| Parameter | Description |
|-----------|-------------|
| 40004 | Outdoor temperature (BT1) |
| 40033 | Room temperature (BT50) |
| 40013 | Hot water top (BT7) |
| 43005 | Degree minutes |
| 43009 | Calculated flow temperature |
| 44270 | Compressor hours (heating) |
| 49994 | Priority (off / heating / hot water) |

Find more by calling `get_device_points` without a filter.

## Scopes

| Scope | Access |
|-------|--------|
| `READSYSTEM` | Read sensor data and settings |
| `WRITESYSTEM` | Change settings (requires Premium subscription) |
| `offline_access` | Receive a refresh token for long-lived sessions |

## License

MIT
