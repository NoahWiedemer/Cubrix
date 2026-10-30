#!/usr/bin/env node
// Tiny MCP server for tests, no dependencies. Default: stdio.
// --http: Streamable HTTP, --sse: legacy HTTP+SSE (both on a random port, printed on stdout, Bearer "geheim").
// --crash: fails at once. --ignore-stdin-close: keeps running after stdin ends.
import http from "node:http";
import readline from "node:readline";

const TOOLS = [
  { name: "echo", description: "Gibt den Text zurück.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "hang", description: "Antwortet nie.", inputSchema: { type: "object", properties: {} } },
];

/** Answer to a JSON-RPC request, or null for notifications and `hang`. */
function handle(msg) {
  if (msg.id === undefined) return null;
  const ok = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  if (msg.method === "initialize") return ok({ protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "echo", version: "1.0.0" } });
  if (msg.method === "tools/list") return ok({ tools: TOOLS });
  if (msg.method === "tools/call") {
    if (msg.params.name === "hang") return null;
    return ok({ content: [{ type: "text", text: `${process.env.ECHO_PREFIX ?? ""}${msg.params.arguments?.text ?? ""}` }] });
  }
  return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Unknown method" } };
}

const body = (req) => new Promise((resolve) => { let s = ""; req.on("data", (d) => (s += d)); req.on("end", () => resolve(s)); });
const authorized = (req) => req.headers.authorization === "Bearer geheim";

const mode = process.argv[2];
if (mode === "--crash") {
  console.error("kaputt: Konfiguration fehlt");
  process.exit(1);
} else if (mode === "--http") {
  const server = http.createServer(async (req, res) => {
    if (!authorized(req)) return res.writeHead(401).end();
    if (req.method === "DELETE") return res.writeHead(204).end();
    if (req.method !== "POST") return res.writeHead(405).end();
    const reply = handle(JSON.parse(await body(req)));
    if (!reply) return res.writeHead(202).end();
    // Alternates both answer forms a Streamable HTTP server may use.
    if (reply.result?.tools) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      return res.end(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
    }
    res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "s1" });
    res.end(JSON.stringify(reply));
  });
  server.listen(0, "127.0.0.1", () => console.log(server.address().port));
} else if (mode === "--sse") {
  let stream = null;
  const server = http.createServer(async (req, res) => {
    if (!authorized(req)) return res.writeHead(401).end();
    if (req.method === "GET" && req.url === "/sse") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("event: endpoint\ndata: /messages?session=1\n\n");
      stream = res;
      return;
    }
    if (req.method === "POST" && req.url.startsWith("/messages")) {
      const reply = handle(JSON.parse(await body(req)));
      res.writeHead(202).end();
      if (reply) stream.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
      return;
    }
    res.writeHead(405).end();
  });
  server.listen(0, "127.0.0.1", () => console.log(server.address().port));
} else {
  const lines = readline.createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    const reply = handle(JSON.parse(line));
    if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
  });
  if (mode === "--ignore-stdin-close") {
    process.on("SIGTERM", () => {}); // must take the SIGKILL
    setInterval(() => {}, 1000);
  } else lines.on("close", () => process.exit(0));
}
