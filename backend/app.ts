import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { handleGetBook } from "./book-api";
import type { BookChain } from "./book-api";
import { toRouteResult } from "./errors";
import type { RouteResult } from "./errors";
import { logger } from "./logger";
import type { MembershipStore } from "./membership-store";
import {
  handleJoinMembership,
  handleLeaveMembership,
  handleListMemberships,
} from "./memberships-api";
import { handleFinalizePayment, handlePreparePayment } from "./payments-api";
import type { PaymentChain } from "./payments-api";
import { requestContext } from "./request-context";

const dirname = path.dirname(fileURLToPath(import.meta.url));

function send(res: Response, result: RouteResult): void {
  res.status(result.status).json(result.body);
}

function isAsset(url: string): boolean {
  return (
    url.startsWith("/assets/") ||
    /\.(js|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf)(\?.*)?$/i.test(url)
  );
}

export interface AppDependencies {
  store: MembershipStore;
  bookChain?: BookChain;
  paymentChain?: PaymentChain;
}

export function createApp({ store, bookChain, paymentChain }: AppDependencies): express.Express {
  const app = express();
  app.use(express.json());
  app.use(cors());

  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    const start = Date.now();
    res.on("finish", () => {
      const status = res.statusCode;
      const fields = {
        requestId,
        method: req.method,
        url: req.originalUrl,
        status,
        durationMs: Date.now() - start,
      };
      if (status >= 500) logger.error("request failed", fields);
      else if (status >= 400) logger.warn("request errored", fields);
      else if (isAsset(req.originalUrl)) logger.debug("request", fields);
      else logger.info("request", fields);
    });
    requestContext.run({ requestId }, next);
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
    const result = await handleGetBook(req.params.code, req.query, bookChain);
    send(res, result);
  });

  app.post("/api/payments/prepare", async (req: Request, res: Response) => {
    const result = await handlePreparePayment(req.body ?? {}, paymentChain);
    send(res, result);
  });

  app.post("/api/payments/finalize", async (req: Request, res: Response) => {
    const result = await handleFinalizePayment(req.body ?? {}, paymentChain);
    send(res, result);
  });

  const isProduction = process.env.NODE_ENV === "production";
  const distDir = path.join(dirname, "..", "frontend", "dist");
  if (isProduction && existsSync(distDir)) {
    app.use(express.static(distDir));
    app.use((req: Request, res: Response) => {
      if (req.method === "GET" && req.accepts("html")) {
        res.sendFile(path.join(distDir, "index.html"));
      } else {
        res.status(404).json({ error: { kind: "invalid", message: "Not found" } });
      }
    });
  }

  // Central handler for anything that escapes the route handlers: malformed JSON
  // bodies, throws in middleware, and future unguarded routes.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && err.message.includes("JSON")) {
      logger.warn("malformed JSON body", { url: req.originalUrl });
      res.status(400).json({ error: { kind: "invalid", message: "Request body is not valid JSON" } });
      return;
    }
    logger.error("unhandled route error", {
      requestId: res.locals.requestId,
      method: req.method,
      url: req.originalUrl,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    send(res, toRouteResult(err));
  });

  return app;
}
