# PropWorks portfolio MCP (read-only)

A **local stdio** [MCP](https://modelcontextprotocol.io) server that lets an AI client (Claude Desktop, Cursor, …) query **your own** PropWorks portfolio: properties, leases, rent months, balances and expenses. It understands subsidies: Section 8 / CityFHEPS / HRA.

- **Strictly read-only.** It only runs `SELECT` on an allowlist of tables. It never inserts, updates, deletes, upserts, calls RPCs, touches storage or writes to the outbox. CI enforces this (`test/readonly-test.ts`).
- **Your session, your rows.** It signs in as you with the public **anon** key. Supabase Row-Level Security limits every query to your portfolio. `service_role` / `sb_secret_` keys are **refused**.
- **Same math as the app.** Balances and statuses come from the app's own `src/lib` code (payer setup, `chargeStatus`, the triage view).
- Runs on your computer only. There is no hosted server and no edge function.

## Tools

| Tool | What it returns |
|---|---|
| `list_properties` | Properties with their units |
| `list_leases` | Leases with tenant, unit, payer setup, gov program and portions. Filters: `active_only` (default true), `ending_within_days`, `payer_setup` (`self_pay` \| `gov_tenant` \| `gov_hra`), `limit` |
| `get_lease` | One lease plus its last 12 months: status (Full / Partial / Due / Late / Unknown) and who owes what |
| `list_rent_charges` | Rent months. Filters: `from_month` / `to_month` (YYYY-MM), `status`, `lease_id`, `limit` |
| `get_balances` | Outstanding through this month: total, `by_payer` {gov, tenant, hra}, and per lease |
| `list_expenses` | Expenses with total. Filters: `from_date` / `to_date`, `property_id`, `limit` |

Results are compact JSON, capped at 200 items, with `total` / `truncated` fields.

## Setup

```bash
cd mcp
npm ci           # also needs the repo root `npm ci` (it reuses ../src/lib)
```

Environment variables (set them in your MCP client config, **never in the repo**):

| Var | Value |
|---|---|
| `PROPWORKS_SUPABASE_URL` | Your project URL (same as the app's `VITE_SUPABASE_URL`) |
| `PROPWORKS_SUPABASE_ANON_KEY` | The **anon / publishable** key (same as `VITE_SUPABASE_ANON_KEY`) |
| `PROPWORKS_EMAIL` + `PROPWORKS_PASSWORD` | Your PropWorks login, **or** |
| `PROPWORKS_REFRESH_TOKEN` | A refresh token from a signed-in session |

### Claude Desktop (`claude_desktop_config.json`) / Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "propworks": {
      "command": "npx",
      "args": ["--prefix", "/ABSOLUTE/PATH/propworks/mcp", "tsx", "/ABSOLUTE/PATH/propworks/mcp/src/server.ts"],
      "env": {
        "PROPWORKS_SUPABASE_URL": "https://YOUR-PROJECT.supabase.co",
        "PROPWORKS_SUPABASE_ANON_KEY": "YOUR-ANON-KEY",
        "PROPWORKS_EMAIL": "you@example.com",
        "PROPWORKS_PASSWORD": "..."
      }
    }
  }
}
```

Restart the client, then ask something like *"Who owes rent this month, split by Section 8 vs tenant vs HRA?"* or *"Which leases end in the next 60 days?"*

Without credentials the server still starts and lists its tools. Calls return a clear "set env" error.

## Security notes

- The client config file holds your password or refresh token, so keep it private. A refresh token is safer than a password: signing out everywhere in the app revokes it.
- The AI client sees whatever these tools return (tenant names, amounts). Use it only with clients you trust with that data.
- Nothing is written. To change data, use the app.
- Never put a `service_role` key here; the server exits with an error if you do.

## Tests

```bash
npm test         # handler tests (mocked Supabase) + no-write static guard
npm run typecheck
```
