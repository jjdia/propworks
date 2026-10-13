#!/usr/bin/env node
// PropWorks portfolio MCP (issue #17): local stdio, STRICTLY read-only.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createHandlers, MAX_ROWS, type ReadSource } from './handlers';
import { connect, supabaseSource } from './supabaseSource';

const month = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/).describe('YYYY-MM');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD');
const limit = z.number().int().min(1).max(MAX_ROWS).optional().describe(`Max items (≤ ${MAX_ROWS})`);
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function buildServer(getSource: () => Promise<ReadSource>) {
  const server = new McpServer({ name: 'propworks-portfolio', version: '0.1.0' });
  let handlers: ReturnType<typeof createHandlers> | null = null;
  const h = async () => (handlers ??= createHandlers(await getSource()));
  const reply = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] });
  const run = <A,>(fn: (x: Awaited<ReturnType<typeof h>>, a: A) => Promise<unknown>) => async (a: A) => {
    try { return reply(await fn(await h(), a)); } catch (e) { return { ...reply({ error: e instanceof Error ? e.message : String(e) }), isError: true }; }
  };

  server.registerTool('list_properties', { description: 'Properties and their units.', inputSchema: {}, annotations: RO }, run((x) => x.list_properties()));
  server.registerTool('list_leases', {
    description: 'Leases with tenant/unit, payer setup (self_pay | gov_tenant | gov_hra), gov program and portions.',
    inputSchema: { active_only: z.boolean().optional().describe('Default true'), ending_within_days: z.number().int().min(0).max(3650).optional(), payer_setup: z.enum(['self_pay', 'gov_tenant', 'gov_hra']).optional(), limit },
    annotations: RO,
  }, run((x, a) => x.list_leases(a)));
  server.registerTool('get_lease', { description: 'One lease with its last 12 months of per-payer rent status.', inputSchema: { lease_id: z.string().min(1) }, annotations: RO }, run((x, a) => x.get_lease(a)));
  server.registerTool('list_rent_charges', {
    description: 'Monthly rent charges with app status (Full/Partial/Due/Late/Unknown) and who owes what.',
    inputSchema: { from_month: month.optional(), to_month: month.optional(), status: z.enum(['Full', 'Partial', 'Due', 'Late', 'Unknown']).optional(), lease_id: z.string().optional(), limit },
    annotations: RO,
  }, run((x, a) => x.list_rent_charges(a)));
  server.registerTool('get_balances', { description: 'Outstanding rent through this month, by lease and by payer (gov / tenant / hra). Same math as the app triage view.', inputSchema: { limit }, annotations: RO }, run((x, a) => x.get_balances(a)));
  server.registerTool('list_expenses', { description: 'Expenses (optionally by date range / property) with total.', inputSchema: { from_date: date.optional(), to_date: date.optional(), property_id: z.string().optional(), limit }, annotations: RO }, run((x, a) => x.list_expenses(a)));
  return server;
}

const isMain = process.argv[1] && /server\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  // Sign in lazily on first tool call so the server still starts (and lists
  // tools) without credentials; errors come back as tool errors.
  const server = buildServer(async () => supabaseSource(await connect()));
  await server.connect(new StdioServerTransport());
}
