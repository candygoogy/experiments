// The numbers the checks and their words share: kept apart from the
// rules (verdict.ts), so the page's words load without them.

// The SPF limit: past 10 DNS lookups it breaks.
export const MAX_LOOKUPS = 10;
// The mx term breaks past this many mail servers (RFC 7208, 4.6.4).
export const MAX_MX_HOSTS = 10;
// RSA keys shorter than this are weak (RFC 8301: 2048 recommended).
export const MIN_RSA_BITS = 2048;
// Receivers ignore signatures made with RSA keys shorter than this (RFC
// 8301, 3.2).
export const VALID_RSA_BITS = 1024;
