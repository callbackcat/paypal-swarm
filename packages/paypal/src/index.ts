export * from "./types";
export * from "./errors";
export * from "./trim";
export * from "./cards";
export * from "./allowlists";
export * from "./rest";
export * from "./sandbox";
export * from "./mock";

import type { PayPalBackend, PayPalCreds } from "./types";
import { mockBackend, type MockOptions } from "./mock";
import { sandboxBackend } from "./sandbox";

/** Picks the backend from credentials: real sandbox when a client id/secret is present, otherwise mock. */
export function backendFor(creds: Partial<PayPalCreds> | undefined, mock: MockOptions = {}): PayPalBackend {
  if (creds?.clientId && creds.clientSecret) return sandboxBackend({ clientId: creds.clientId, clientSecret: creds.clientSecret, merchantId: creds.merchantId });
  return mockBackend(mock);
}

export * from "./catalog";
