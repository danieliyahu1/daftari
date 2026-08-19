import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { TursoAuthStore } from "./auth-store";
import { logger } from "./logger";
import { TursoMembershipStore } from "./membership-store";
import { TursoWalletStore } from "./wallet-store";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const tursoUrl = process.env.DAFTARI_TURSO_URL;
const tursoAuthToken = process.env.DAFTARI_TURSO_AUTH_TOKEN;

if (tursoUrl === undefined) {
  logger.error("DAFTARI_TURSO_URL is not set");
  process.exit(1);
}
if (tursoAuthToken === undefined) {
  logger.error("DAFTARI_TURSO_AUTH_TOKEN is not set");
  process.exit(1);
}

const walletStore = new TursoWalletStore({ url: tursoUrl, authToken: tursoAuthToken });
const store = new TursoMembershipStore({ url: tursoUrl, authToken: tursoAuthToken });
const authStore = new TursoAuthStore({ url: tursoUrl, authToken: tursoAuthToken });

const authSecretRaw =
  process.env.DAFTARI_AUTH_SECRET ??
  "daftari-dev-only-secret-change-me-in-production";
if (process.env.DAFTARI_AUTH_SECRET === undefined) {
  logger.warn("DAFTARI_AUTH_SECRET is not set; using an insecure development secret");
}
const authSecret = new TextEncoder().encode(authSecretRaw);

const origin = process.env.DAFTARI_ORIGIN ?? "http://localhost:5173";

const app = createApp({
  store,
  walletStore,
  authStore,
  authSecret,
  origin,
});

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled promise rejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on("uncaughtException", (err) => {
  logger.error("uncaught exception", { message: err.message, stack: err.stack });
  process.exit(1);
});

async function main(): Promise<void> {
  try {
    await walletStore.init();
    await store.init();
    await authStore.init();
  } catch (err) {
    logger.error("failed to initialize stores", {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    process.exit(1);
  }

  const port = Number(process.env.PORT ?? 3001);
  const server = app.listen(port, () => {
    logger.info(`Daftari API listening on http://localhost:${port}`);
  });
  server.on("error", (err) => {
    logger.error("server failed to start", { message: err.message, stack: err.stack });
    process.exit(1);
  });
}

void main();
