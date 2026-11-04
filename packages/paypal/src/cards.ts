import type { CardDetails } from "./types";

/** Static sandbox test cards (always approve unless the holder name carries a rejection trigger). */
export const TEST_CARDS: Record<CardDetails["brand"], Omit<CardDetails, "name">> = {
  VISA: { brand: "VISA", number: "4012888888881881", expiry: "2030-12", securityCode: "123" },
  MASTERCARD: { brand: "MASTERCARD", number: "2223000048400011", expiry: "2030-12", securityCode: "123" },
  AMEX: { brand: "AMEX", number: "371449635398431", expiry: "2030-12", securityCode: "1234" },
};

/**
 * Sandbox "rejection triggers": putting one of these in the cardholder name makes the capture come back
 * HTTP 200 with captures[0].status = DECLINED and a processor_response. Only works on api-m.sandbox.paypal.com.
 */
export const DECLINE_TRIGGERS = {
  refused: "CCREJECT-REFUSED",
  insufficientFunds: "CCREJECT-IF",
  securityFailure: "CCREJECT-SF",
  expiredCard: "CCREJECT-EC",
  invalidRequest: "CCREJECT-IRC",
  lostOrStolen: "CCREJECT-LS",
  invalidAccount: "CCREJECT-IA",
  bankError: "CCREJECT-BANK_ERROR",
  cvvFailure: "CCREJECT-CVV_F",
} as const;
export type DeclineKind = keyof typeof DECLINE_TRIGGERS;

export function cardFor(brand: CardDetails["brand"], holderName: string, decline?: DeclineKind): CardDetails {
  return { ...TEST_CARDS[brand], name: decline ? DECLINE_TRIGGERS[decline] : holderName };
}

export const isDeclineName = (name: string) => /^CCREJECT-/.test(name);

export const BILLING_ADDRESS = {
  address_line_1: "2211 N First St",
  admin_area_2: "San Jose",
  admin_area_1: "CA",
  postal_code: "95131",
  country_code: "US",
};
