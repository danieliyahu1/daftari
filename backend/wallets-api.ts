import type { WalletKind } from "../shared/types";
import { toRouteResult } from "./errors";
import type { RouteResult } from "./errors";
import { AppError } from "./errors";
import { logger } from "./logger";
import type { WalletStore } from "./wallet-store";

export const NAME_ERROR_COPY = "Names are between 2 and 20 characters.";

export interface RegisterWalletInput {
  name?: unknown;
  kind?: unknown;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function validateName(value: unknown): string {
  if (typeof value !== "string") {
    throw new AppError("invalid", "name is required", 400);
  }
  const name = value.trim();
  if (name.length < 2 || name.length > 20 || CONTROL_CHARACTERS.test(name)) {
    throw new AppError("invalid", NAME_ERROR_COPY);
  }
  return name;
}

function validateKind(value: unknown): WalletKind {
  if (value !== "user" && value !== "group") {
    throw new AppError("invalid", "kind must be either user or group");
  }
  return value;
}

export async function handleRegisterWallet(
  store: WalletStore,
  requester: string,
  input: RegisterWalletInput,
): Promise<RouteResult> {
  try {
    const address = requester;
    const name = validateName(input.name);
    const kind = validateKind(input.kind);
    const wallet = await store.register(address, name, kind);
    logger.info("wallet registered", { address, kind, name });
    return { status: 201, body: { wallet } };
  } catch (err) {
    return toRouteResult(err);
  }
}

function parseAddresses(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const parts = (Array.isArray(value) ? value : [value])
    .filter((part): part is string => typeof part === "string")
    .flatMap((part) => part.split(","));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

export async function handleResolveWallets(
  store: WalletStore,
  addressesParam: unknown,
): Promise<RouteResult> {
  try {
    const addresses = parseAddresses(addressesParam);
    const wallets = await store.resolveMany(addresses);
    logger.debug("wallets resolved", { requested: addresses.length, found: wallets.length });
    return { status: 200, body: { wallets } };
  } catch (err) {
    return toRouteResult(err);
  }
}
