import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import type { Request, Response } from "express";
import { handleGetBook } from "./book-api";
import type { RouteResult } from "./errors";
import { SqliteMembershipStore } from "./membership-store";
import {
  handleJoinMembership,
  handleLeaveMembership,
  handleListMemberships,
} from "./memberships-api";
import { handleFinalizePayment, handlePreparePayment } from "./payments-api";

const dirname = path.dirname(fileURLToPath(import.meta.url));

function send(res: Response, result: RouteResult): void {
  res.status(result.status).json(result.body);
}

const app = express();
app.use(express.json());
app.use(cors());

const store = new SqliteMembershipStore({
  filename: process.env.DAFTARI_DB ?? path.join(dirname, "..", "daftari.db"),
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/memberships", (req: Request, res: Response) => {
  send(res, handleListMemberships(store, req.query.user));
});

app.post("/api/memberships", (req: Request, res: Response) => {
  send(res, handleJoinMembership(store, req.body ?? {}));
});

app.delete("/api/memberships", (req: Request, res: Response) => {
  send(res, handleLeaveMembership(store, req.body ?? {}));
});

app.get("/api/chamas/:code/book", async (req: Request, res: Response) => {
  const result = await handleGetBook(req.params.code, req.query);
  send(res, result);
});

app.post("/api/payments/prepare", async (req: Request, res: Response) => {
  const result = await handlePreparePayment(req.body ?? {});
  send(res, result);
});

app.post("/api/payments/finalize", async (req: Request, res: Response) => {
  const result = await handleFinalizePayment(req.body ?? {});
  send(res, result);
});

const distDir = path.join(dirname, "..", "frontend", "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((req: Request, res: Response) => {
    if (req.method === "GET" && req.accepts("html")) {
      res.sendFile(path.join(distDir, "index.html"));
    } else {
      res.status(404).json({ error: { kind: "invalid", message: "Not found" } });
    }
  });
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`Daftari API listening on http://localhost:${port}`);
});
