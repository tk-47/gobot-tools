/**
 * Homework Helper — Bun HTTP Server
 *
 * Routes:
 *   GET /          → public/index.html
 *   GET /public/*  → static files
 *   POST /ask      → solve homework question
 *
 * Windows-compatible. Run: bun run start
 */

import { join } from "path";
import { solveHomework } from "./src/solver";
import type { AskRequest } from "./src/types";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const PUBLIC_DIR = join(import.meta.dir, "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function ext(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i) : "";
}

async function serveStatic(filePath: string): Promise<Response> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }
  const mime = MIME[ext(filePath)] ?? "application/octet-stream";
  return new Response(file, { headers: { "Content-Type": mime } });
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 60,

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS for local dev
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Serve index
    if (req.method === "GET" && (path === "/" || path === "/index.html")) {
      return serveStatic(join(PUBLIC_DIR, "index.html"));
    }

    // Serve static files under /public/
    if (req.method === "GET" && path.startsWith("/public/")) {
      const relPath = path.slice("/public/".length);
      return serveStatic(join(PUBLIC_DIR, relPath));
    }

    // Serve root-level public files directly (app.js, styles.css)
    if (req.method === "GET" && (path.endsWith(".js") || path.endsWith(".css"))) {
      return serveStatic(join(PUBLIC_DIR, path.slice(1)));
    }

    // POST /ask — main homework endpoint
    if (req.method === "POST" && path === "/ask") {
      let body: AskRequest;
      try {
        body = await req.json();
      } catch {
        return Response.json(
          { error: "Invalid JSON body" },
          { status: 400, headers: corsHeaders }
        );
      }

      if (!body.question && !body.problemImageBase64) {
        return Response.json(
          { error: "Provide a question or problem image" },
          { status: 400, headers: corsHeaders }
        );
      }

      try {
        const result = await solveHomework(body);
        return Response.json(result, { headers: corsHeaders });
      } catch (err: any) {
        console.error("[/ask] error:", err);
        return Response.json(
          { error: "Something went wrong. Please try again.", detail: err?.message },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
});

console.log(`Homework Helper running at http://localhost:${server.port}`);
console.log(`iPad: find your PC's IP with 'ipconfig' then open http://<IP>:${server.port}`);
