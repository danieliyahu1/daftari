import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
}

// Correlates every log line emitted while serving one HTTP request back to
// that request, so the full story of a bug can be traced with a single id.
export const requestContext = new AsyncLocalStorage<RequestContext>();
