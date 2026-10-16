// How a domain's mail stands, from its report (the first line of the
// answer), and the levels its checks can have (rows.ts).
//
// The question is whether a receiver stops mail that only claims to be
// from the domain. DMARC is what tells receivers to stop it: a message
// passes DMARC only when SPF or DKIM passes for the domain itself (RFC
// 7489, 4.2), and a forger has neither, unless SPF lets anyone send: +all,
// a range that takes in every address, or either of those in a record it
// pulls in (see analyze.ts).
// So:
//   - SPF that lets anyone send: fakes pass, whatever DMARC says;
//   - no DMARC policy that stops fakes (none, broken, p=none): receivers
//     decide on their own, so fakes can get through;
//   - a policy that stops fakes: fakes are stopped. It's well protected
//     when the domain's own mail has both ways to pass (a working SPF
//     record and a DKIM key) and nothing weakens the policy; otherwise
//     it's partly protected. A domain whose SPF record says nobody sends
//     (v=spf1 -all) and that has no DKIM key sends no mail at all, so it
//     needs neither ("parked": well protected, worded for what it is).
//     A DMARC record with a p= or sp= that isn't a policy stops nothing
//     (RFC 7489, 6.6.3), and an SPF range so wide that strangers may be
//     in it keeps a domain from being well protected.
import type { DkimKey, Report } from "./model.ts";

export type Overall =
  "protected" | "parked" | "partly" | "fakeable" | "unchecked";
// Unsafe, broken and missing are the problems; unchecked means a lookup
// didn't answer; weak works but is risky; a note is neither good nor bad.
export type Level =
  "good" | "weak" | "unchecked" | "missing" | "broken" | "unsafe" | "info";

import { MAX_LOOKUPS, MIN_RSA_BITS, VALID_RSA_BITS } from "./limits.ts";

export { MAX_LOOKUPS, MIN_RSA_BITS, VALID_RSA_BITS };

const shorterThan = (k: DkimKey, bits: number) =>
  k.keyType === "rsa" && k.bits !== null && k.bits < bits;

/** Keys a receiver would accept a signature from: not withdrawn, a valid
 * key of a kind receivers know, and long enough. */
export const workingKeys = (r: Report): DkimKey[] =>
  r.dkim.filter(
    (k) => !k.revoked && k.unusable === null && !shorterThan(k, VALID_RSA_BITS),
  );

/** Published, but receivers can't use it: not a valid key, or of a kind
 * they don't know. */
export const isUnusable = (k: DkimKey): boolean =>
  !k.revoked && k.unusable !== null;

/** Accepted, but shorter than recommended. */
export const isShort = (k: DkimKey): boolean => shorterThan(k, MIN_RSA_BITS);

/** Ignored by receivers: an RSA key under 1024 bits. */
export const isTooShort = (k: DkimKey): boolean =>
  !k.revoked && k.unusable === null && shorterThan(k, VALID_RSA_BITS);

/** Whether the DMARC policy stops fakes: quarantine or reject, applied to
 * at least some of them. Under p=quarantine, the fakes pct= leaves out are
 * delivered as usual, so pct=0 stops none; under p=reject they go to spam
 * instead (RFC 7489, 6.6.4). */
export function stopsFakes(r: Report): boolean {
  const d = r.dmarc;
  if (d.kind !== "one" || d.invalid !== null) return false;
  if (d.policy === "reject") return true;
  return d.policy === "quarantine" && d.pct > 0;
}

/** SPF lets anyone pass: +all, or a term anywhere in what it pulls in
 * that takes in every sender. */
export const anyoneSends = (r: Report): boolean =>
  r.spf.kind === "one" && (r.spf.open !== null || r.spf.all === "+");

/** The SPF record names no sender and rejects everyone else: "v=spf1
 * -all", the record of a domain that sends no mail. */
export const nobodySends = (r: Report): boolean =>
  r.spf.kind === "one" &&
  r.spf.all === "-" &&
  !r.spf.senders &&
  !anyoneSends(r);

/** The SPF record works: one record, well formed, under the lookup limit,
 * with nothing in it that receivers treat as an error, and naming someone
 * who may send (or saying nobody does). */
export function spfWorks(r: Report): boolean {
  const { spf } = r;
  return (
    spf.kind === "one" &&
    spf.lookups <= MAX_LOOKUPS &&
    !spf.loop &&
    spf.emptyRedirect === null &&
    spf.emptyInclude === null &&
    spf.syntax === null &&
    spf.manyAt === null &&
    spf.mxOver === null &&
    (spf.senders || nobodySends(r))
  );
}

/** What keeps a domain whose fakes are stopped from being well protected:
 * a policy applied to only some fakes, subdomains left open, signing keys
 * that are all shorter than recommended, or an SPF range so wide that
 * strangers may be in it. */
export function weaknesses(r: Report): ("pct" | "sp" | "key" | "wide")[] {
  const out: ("pct" | "sp" | "key" | "wide")[] = [];
  const d = r.dmarc;
  if (d.kind === "one" && stopsFakes(r)) {
    if (d.pct < 100) out.push("pct");
    if (d.subdomains === "none" && d.from === r.domain) out.push("sp");
  }
  // One strong key is enough: a short key under a spare name doesn't
  // weaken the others.
  const keys = workingKeys(r);
  if (keys.length && keys.every(isShort)) out.push("key");
  if (r.spf.kind === "one" && r.spf.wide !== null && !anyoneSends(r)) {
    out.push("wide");
  }
  return out;
}

/** The checks that couldn't be made and that the verdict depends on. */
export function unchecked(r: Report): ("dmarc" | "spf" | "spfPart")[] {
  const out: ("dmarc" | "spf" | "spfPart")[] = [];
  if (r.dmarc.kind === "unchecked") out.push("dmarc");
  if (r.spf.kind === "unchecked") out.push("spf");
  else if (
    r.spf.kind === "one" &&
    (r.spf.unchecked.length || r.spf.uncheckedExists.length) &&
    spfWorks(r)
  ) {
    out.push("spfPart");
  }
  return out;
}

export function overall(r: Report): Overall {
  // Anyone passes SPF, so a fake passes DMARC too.
  if (anyoneSends(r)) return "fakeable";
  if (r.dmarc.kind === "unchecked") return "unchecked";
  // Without a policy that stops fakes, nothing else stops them.
  if (!stopsFakes(r)) return "fakeable";
  // A part of SPF that didn't answer could still hold a +all (through a
  // redirect), so the verdict waits for it.
  if (unchecked(r).length) return "unchecked";
  if (weaknesses(r).length) return "partly";
  const signs = workingKeys(r).length > 0;
  // With any key published it still sends (signed only), so it's judged
  // like any other domain.
  if (nobodySends(r) && spfWorks(r) && !r.dkim.some((k) => !k.revoked)) {
    return "parked";
  }
  return spfWorks(r) && signs ? "protected" : "partly";
}

// For the SPF row: a missing or broken SPF record under a policy that
// stops fakes leaves the domain's own mail to DKIM alone.
export const ownMailNeedsDkim = (r: Report): boolean =>
  stopsFakes(r) &&
  !anyoneSends(r) &&
  r.spf.kind !== "unchecked" &&
  !spfWorks(r);
