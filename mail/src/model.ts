// What a domain's mail records say, as plain data: what the page words and
// judges. Built from DNS answers by analyze.ts. A lookup that didn't answer
// (the resolver failed, timed out, or cut the answer short) is "unchecked":
// never taken to mean the record isn't there.

export interface MxHost {
  host: string;
  preference: number;
  // The name is an alias (CNAME), which mail servers shouldn't have to
  // follow.
  alias: boolean;
}

export type Mx =
  | { kind: "none" }
  // "0 .": the domain says it receives no mail.
  | { kind: "null" }
  // nullToo: a null MX is listed beside them, which RFC 7505 (3) forbids:
  // it must be the only one.
  | { kind: "hosts"; hosts: MxHost[]; nullToo: boolean }
  | { kind: "unchecked" };

// The SPF record's last word on everyone it doesn't list.
export type All = "-" | "~" | "?" | "+" | null;

// A term in an SPF record, as written, and the name whose record holds it:
// null for the domain's own record, else a record it pulls in.
export interface SpfTerm {
  term: string;
  from: string | null;
}

export type Spf =
  | { kind: "none" }
  | { kind: "many"; count: number }
  | { kind: "unchecked" }
  | {
      kind: "one";
      record: string;
      // The last word that applies: the record's own, or, for a record
      // that only redirects, the one its redirect ends on.
      all: All;
      // Where that last word came from, when it came through a redirect.
      allFrom: string | null;
      // DNS lookups it takes, counted through every include and redirect
      // each time it's met, as receivers count them.
      lookups: number;
      // Some names it pulls in didn't answer: the count is a minimum.
      unchecked: string[];
      // Some exists terms' names didn't answer: whether they let anyone
      // send is unknown (the lookup count isn't).
      uncheckedExists: string[];
      // Includes and redirects to a name with a macro in it, as written:
      // the name depends on the sender, so it isn't looked up (the lookup
      // still counts), and who it lets send is unknown.
      macros: string[];
      // Its own redirect, or one that redirect leads to, didn't answer,
      // loops, leads to a name with no SPF record, or names a name with a
      // macro in it: the last word is unknown. The same in a record it
      // includes doesn't count; that record's redirect isn't this one's
      // last word.
      redirectUnknown: boolean;
      // It pulls itself in again: receivers treat that as broken.
      loop: boolean;
      // A redirect (its own, or one it pulls in) leads to a name with no
      // SPF record: receivers treat that as broken too.
      emptyRedirect: string | null;
      // An include (its own, or one it pulls in) names a domain with no SPF
      // record: broken as well.
      emptyInclude: string | null;
      ptr: boolean;
      // The first term that breaks SPF's syntax (RFC 7208, 12), in its own
      // record or one it pulls in: receivers treat the record as broken.
      syntax: SpfTerm | null;
      // A name it pulls in that has more than one SPF record: broken too.
      manyAt: string | null;
      // The term that lets anyone at all pass: "+all", a range that takes
      // in every address, or one of those in a record it pulls in.
      open: SpfTerm | null;
      // A range so wide that senders who aren't the domain's may be in it.
      wide: SpfTerm | null;
      // It names at least one sender (an address, a host, or a record that
      // names one). Without one, its own mail never passes SPF.
      senders: boolean;
      // Its mx term covers this many mail servers, more than 10: broken
      // (RFC 7208, 4.6.4). null when it's within the limit or has none.
      mxOver: number | null;
    };

export interface DkimKey {
  selector: string;
  keyType: string;
  // The key's length, when it can be read from the record.
  bits: number | null;
  // p= is empty: the key was withdrawn.
  revoked: boolean;
  // Why receivers can't use it, when they can't: the key isn't a valid key
  // ("bad"), or it's of a kind they don't know ("kind").
  unusable: "bad" | "kind" | null;
}

export type Policy = "none" | "quarantine" | "reject";

export type Dmarc =
  // notFirst: the name with a record that looks like DMARC but doesn't
  // start with v=DMARC1, which receivers ignore.
  | { kind: "none"; notFirst?: string }
  | { kind: "unchecked" }
  | { kind: "many"; count: number; from: string }
  | {
      kind: "one";
      // The domain whose record applies: the one checked, or the nearest
      // parent with a record (the DMARC tree walk).
      from: string;
      // The policy for the domain checked: p= for its own record, sp= (or
      // else p=) for a parent's.
      policy: Policy | null;
      pct: number;
      // sp=: the policy for the domain's subdomains, when it's set.
      subdomains: Policy | null;
      // rua= holds an address reports can be sent to.
      reports: boolean;
      // A p= or sp= that isn't a policy, as written. Receivers then treat
      // the record as p=none when it asks for reports, and ignore it when
      // it doesn't (RFC 7489, 6.6.3).
      invalid: string | null;
    };

export interface Report {
  domain: string;
  mx: Mx;
  spf: Spf;
  dkim: DkimKey[];
  // How many of the common DKIM names didn't answer.
  dkimUnchecked: number;
  dmarc: Dmarc;
  // null: the lookup didn't answer.
  mtaSts: boolean | null;
  tlsRpt: boolean | null;
  dnssec: boolean;
}
