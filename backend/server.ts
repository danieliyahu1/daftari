import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { logger } from "./logger";
import { SqliteMembershipStore } from "./membership-store";
import { SqliteWalletStore } from "./wallet-store";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const dbFilename = process.env.DAFTARI_DB ?? path.join(dirname, "..", "daftari.db");

const walletStore = new SqliteWalletStore({ filename: dbFilename });
const store = new SqliteMembershipStore({ filename: dbFilename });

const app = createApp({ store, walletStore });

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

const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, () => {
  logger.info(`Daftari API listening on http://localhost:${port}`);
});
server.on("error", (err) => {
  logger.error("server failed to start", { message: err.message, stack: err.stack });
  process.exit(1);
});
