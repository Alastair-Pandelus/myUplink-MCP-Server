#!/usr/bin/env node
/**
 * MCP Server – NIBE myUplink
 * Exposes myUplink heat-pump data and controls as MCP tools.
 *
 * Environment variables (required):
 *   MYUPLINK_CLIENT_ID      – OAuth2 client id from dev.myuplink.com
 *   MYUPLINK_CLIENT_SECRET  – OAuth2 client secret
 *
 * Optional:
 *   MYUPLINK_ACCESS_TOKEN   – pre-existing access token
 *   MYUPLINK_REFRESH_TOKEN  – pre-existing refresh token
 *   MYUPLINK_REDIRECT_URI   – callback URL registered at dev.myuplink.com
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as dotenv from "dotenv";
import { MyUplinkClient } from "./myuplink-client.js";

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");
dotenv.config({ path: envPath, quiet: true });

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const clientId = process.env.MYUPLINK_CLIENT_ID;
const clientSecret = process.env.MYUPLINK_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "❌  MYUPLINK_CLIENT_ID and MYUPLINK_CLIENT_SECRET must be set."
  );
  process.exit(1);
}

const client = new MyUplinkClient(
  clientId,
  clientSecret,
  process.env.MYUPLINK_REDIRECT_URI ?? "http://localhost:3000/callback"
);

// Restore tokens when provided via environment
if (process.env.MYUPLINK_ACCESS_TOKEN) {
  client.setTokens(
    process.env.MYUPLINK_ACCESS_TOKEN,
    process.env.MYUPLINK_REFRESH_TOKEN
  );
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "myuplink-mcp",
  version: "1.0.0",
});

// ── Tool: get_authorization_url ───────────────────────────────────────────────
server.tool(
  "get_authorization_url",
  "Get the OAuth2 authorization URL. Open this URL in a browser to log in and grant access. After approval you will be redirected to the redirect_uri with a 'code' query parameter.",
  {
    scope: z
      .string()
      .optional()
      .default("READSYSTEM WRITESYSTEM offline_access")
      .describe("OAuth2 scopes to request"),
  },
  async ({ scope }) => {
    const url = client.getAuthorizationUrl(scope);
    return {
      content: [
        {
          type: "text",
          text: `Open this URL in a browser to authorize:\n\n${url}\n\nAfter login, copy the 'code' parameter from the redirect URL and call exchange_auth_code.`,
        },
      ],
    };
  }
);

// ── Tool: exchange_auth_code ──────────────────────────────────────────────────
server.tool(
  "exchange_auth_code",
  "Exchange an OAuth2 authorization code (from the redirect callback) for access and refresh tokens.",
  {
    code: z.string().describe("The authorization code from the redirect URL"),
  },
  async ({ code }) => {
    try {
      const tokens = await client.exchangeCode(code);
      return {
        content: [
          {
            type: "text",
            text: `✅ Authenticated successfully!\nAccess token expires in ${tokens.expires_in}s.\n${tokens.refresh_token ? "Refresh token received – sessions will auto-renew." : "No refresh token – re-authenticate when the token expires."}`,
          },
        ],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `❌ Token exchange failed: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: authenticate_client_credentials ─────────────────────────────────────
server.tool(
  "authenticate_client_credentials",
  "Authenticate using Client Credentials flow (no user login required). Only grants access to your own application's data. Use this for server-to-server scenarios.",
  {
    scope: z.string().optional().default("READSYSTEM"),
  },
  async ({ scope }) => {
    try {
      const tokens = await client.authenticateClientCredentials(scope);
      return {
        content: [
          {
            type: "text",
            text: `✅ Authenticated via client credentials.\nToken valid for ${tokens.expires_in}s.`,
          },
        ],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `❌ Authentication failed: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: get_systems ─────────────────────────────────────────────────────────
server.tool(
  "get_systems",
  "List all heat-pump systems connected to the myUplink account.",
  {},
  async () => {
    try {
      const systems = await client.getSystems();
      if (!systems.length) {
        return {
          content: [{ type: "text", text: "No systems found in this account." }],
        };
      }
      const text = systems
        .map(
          (s) =>
            `🏠 ${s.name} (ID: ${s.systemId})\n` +
            `   Country: ${s.country} | Alarm: ${s.hasAlarm ? "⚠️ YES" : "✅ none"}\n` +
            s.devices
              .map(
                (d) =>
                  `   📟 ${d.product.name} (device ID: ${d.id}) – FW ${d.currentFwVersion} – ${d.connectionState}`
              )
              .join("\n")
        )
        .join("\n\n");
      return { content: [{ type: "text", text }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `❌ ${msg}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: get_system ──────────────────────────────────────────────────────────
server.tool(
  "get_system",
  "Get detailed information about a specific system.",
  {
    system_id: z.string().describe("The system ID (from get_systems)"),
  },
  async ({ system_id }) => {
    try {
      const system = await client.getSystem(system_id);
      return {
        content: [{ type: "text", text: JSON.stringify(system, null, 2) }],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `❌ ${msg}` }], isError: true };
    }
  }
);

// ── Tool: get_device_points ───────────────────────────────────────────────────
server.tool(
  "get_device_points",
  "Read data points (sensor values, settings) from a device. Returns all parameters when no IDs are specified.",
  {
    device_id: z.string().describe("Device ID (from get_systems)"),
    parameter_ids: z
      .array(z.string())
      .optional()
      .describe(
        "Optional list of parameter IDs to filter (e.g. ['40004','40013']). Omit to get all."
      ),
  },
  async ({ device_id, parameter_ids }) => {
    try {
      const points = await client.getDevicePoints(device_id, parameter_ids);
      if (!points.length) {
        return {
          content: [{ type: "text", text: "No data points returned." }],
        };
      }
      const text = points
        .map(
          (p) =>
            `[${p.parameterId}] ${p.parameterName}: ${p.strVal ?? p.value}${p.parameterUnit ? " " + p.parameterUnit : ""}` +
            (p.writable ? " ✏️" : "")
        )
        .join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `❌ ${msg}` }], isError: true };
    }
  }
);

// ── Tool: set_device_points ───────────────────────────────────────────────────
server.tool(
  "set_device_points",
  "Write new values to writable parameters on a device. Requires WRITESYSTEM scope and usually a myUplink Premium subscription.",
  {
    device_id: z.string().describe("Device ID"),
    settings: z
      .string()
      .describe(
        'JSON string with parameterId → value pairs, e.g. \'{"40004": 220, "48132": 1}\''
      ),
  },
  async ({ device_id, settings }) => {
    try {
      const parsed: Record<string, string | number> = JSON.parse(settings);
      await client.setDevicePoints(device_id, parsed as Record<string, string | number>);
      return {
        content: [
          {
            type: "text",
            text: `✅ Settings updated on device ${device_id}:\n${JSON.stringify(parsed, null, 2)}`,
          },
        ],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `❌ ${msg}` }], isError: true };
    }
  }
);

// ── Tool: get_device ──────────────────────────────────────────────────────────
server.tool(
  "get_device",
  "Get metadata about a specific device (firmware version, connection state, serial number).",
  {
    device_id: z.string().describe("Device ID"),
  },
  async ({ device_id }) => {
    try {
      const device = await client.getDevice(device_id);
      const text =
        `📟 ${device.product.name}\n` +
        `   Serial:     ${device.product.serialNumber}\n` +
        `   FW version: ${device.currentFwVersion}\n` +
        `   Connection: ${device.connectionState}`;
      return { content: [{ type: "text", text }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `❌ ${msg}` }], isError: true };
    }
  }
);

// ── Tool: get_alarms ─────────────────────────────────────────────────────────
server.tool(
  "get_alarms",
  "Get active alarms / notifications for a system.",
  {
    system_id: z.string().describe("System ID"),
  },
  async ({ system_id }) => {
    try {
      const alarms = await client.getAlarms(system_id);
      return {
        content: [
          { type: "text", text: JSON.stringify(alarms, null, 2) },
        ],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `❌ ${msg}` }], isError: true };
    }
  }
);

// ── Tool: get_smart_home_zones ────────────────────────────────────────────────
server.tool(
  "get_smart_home_zones",
  "Get the smart-home zones available on a device (climate zones, etc.).",
  {
    device_id: z.string().describe("Device ID"),
  },
  async ({ device_id }) => {
    try {
      const zones = await client.getSmartHomeZones(device_id);
      return {
        content: [{ type: "text", text: JSON.stringify(zones, null, 2) }],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `❌ ${msg}` }], isError: true };
    }
  }
);

// ── Tool: get_common_parameters ───────────────────────────────────────────────
server.tool(
  "get_common_parameters",
  "Fetch the most commonly useful parameters for a device: room temperature, hot water, outdoor temp, compressor status, etc.",
  {
    device_id: z.string().describe("Device ID"),
  },
  async ({ device_id }) => {
    // Common myUplink parameter IDs (NIBE/compatible)
    const COMMON = [
      "40004", // Outdoor temperature (BT1)
      "40013", // Hot water top (BT7)
      "40014", // Hot water charging (BT6)
      "40033", // Room temperature (BT50)
      "43005", // Degree minutes
      "43009", // Calculated flow temperature
      "43161", // External flow temperature
      "43420", // Calculated cooling supply temperature
      "44270", // Compressor operating time (heat)
      "44071", // Compressor operating time (hot water)
      "50095", // Status (compressor)
      "49994", // Priority
    ];
    try {
      const points = await client.getDevicePoints(device_id, COMMON);
      if (!points.length) {
        return {
          content: [
            {
              type: "text",
              text: "No common parameters found. Try get_device_points without a filter to see all available parameters.",
            },
          ],
        };
      }
      const text =
        "📊 Common parameters:\n\n" +
        points
          .map(
            (p) =>
              `  ${p.parameterName.padEnd(40)} ${(p.strVal ?? String(p.value)).padStart(10)}${p.parameterUnit ? " " + p.parameterUnit : ""}`
          )
          .join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `❌ ${msg}` }], isError: true };
    }
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🌡️  myUplink MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
