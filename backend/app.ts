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
import { AppError } from "./errors";
import { logger } from "./logger";
import type { MembershipStore } from "./membership-store";
import {
  handleAddMember,
  handleGetHome,
} from "./memberships-api";
import { handleFinalizePayment, handlePreparePayment } from "./payments-api";
import type { PaymentChain, ConfirmPolicy } from "./payments-api";
import { requestContext } from "./request-context";
import { handleRegisterWallet, handleResolveWallets } from "./wallets-api";
import {
  handleFinalizeWithdrawal,
  handlePrepareWithdrawal,
} from "./withdrawals-api";
import type { WalletStore } from "./wallet-store";
import type { AuthStore } from "./auth-store";
import {
  handleCreateChallenge,
  handleCreateSession,
  verifyToken,
} from "./auth";
import type { AuthConfig } from "./auth";

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

interface AuthenticatedRequest extends Request {
  user?: { address: string };
}

export interface AppDependencies {
  store: MembershipStore;
  walletStore: WalletStore;
  authStore: AuthStore;
  authSecret: Uint8Array;
  origin: string;
  bookChain?: BookChain;
  paymentChain?: PaymentChain;
  confirmPolicy?: ConfirmPolicy;
}

export function createApp({
  store,
  walletStore,
  authStore,
  authSecret,
  origin,
  bookChain,
  paymentChain,
  confirmPolicy,
}: AppDependencies): express.Express {
  const app = express();
  app.use(express.json());
  app.use(cors());

  const authConfig: AuthConfig = { origin, secret: authSecret };

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

  // Requires a valid bearer token; sets req.user from the token's subject.
  async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const user = await verifyToken(req.headers.authorization, authSecret);
    if (user === null) {
      send(res, toRouteResult(new AppError("unauthorized", "You need to sign in.")));
      return;
    }
    req.user = user;
    next();
  }

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/auth/challenge", async (req: Request, res: Response) => {
    send(res, await handleCreateChallenge(authStore, req.body ?? {}, authConfig));
  });

  app.post("/api/auth/session", async (req: Request, res: Response) => {
    send(res, await handleCreateSession(authStore, req.body ?? {}, authConfig));
  });

  app.get("/api/memberships", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    send(res, await handleGetHome(store, walletStore, req.user!.address));
  });

  app.post("/api/memberships", requireAuth, (req: AuthenticatedRequest, res: Response) => {
    void handleAddMember(store, walletStore, req.user!.address, req.body ?? {}, bookChain).then((result) =>
      send(res, result),
    );
  });

  app.post("/api/wallets/register", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    send(res, await handleRegisterWallet(walletStore, req.user!.address, req.body ?? {}));
  });

  app.get("/api/wallets/resolve", async (req: Request, res: Response) => {
    send(res, await handleResolveWallets(walletStore, req.query.addresses));
  });

  app.get("/api/chamas/:code/book", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const result = await handleGetBook(
      req.params.code,
      req.query,
      bookChain,
      walletStore,
      store,
      req.user!.address,
    );
    send(res, result);
  });

  app.post("/api/payments/prepare", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const result = await handlePreparePayment(req.user!.address, req.body ?? {}, paymentChain, walletStore);
    send(res, result);
  });

  app.post("/api/payments/finalize", requireAuth, async (req: Request, res: Response) => {
    const result = await handleFinalizePayment(req.body ?? {}, paymentChain, confirmPolicy);
    send(res, result);
  });

  app.post("/api/withdrawals/prepare", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const result = await handlePrepareWithdrawal(
      store,
      walletStore,
      req.user!.address,
      req.body ?? {},
      paymentChain,
    );
    send(res, result);
  });

  app.post("/api/withdrawals/finalize", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const result = await handleFinalizeWithdrawal(
      store,
      walletStore,
      req.user!.address,
      req.body ?? {},
      paymentChain,
      confirmPolicy,
    );
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
