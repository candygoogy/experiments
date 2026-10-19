// A domain's mail records, looked up and read into a report: MX, SPF (its
// lookups counted through every include and redirect, as receivers count
// them), DMARC (the domain's own, or its nearest parent's), DKIM under the
// common names, MTA-STS, TLS reporting, and whether the answers are signed.
// A lookup that doesn't answer is never read as "nothing there": what it
// stands for is marked as unchecked.
import { DnsError, type DnsAnswer, type Resolve, type RRType } from "./dns.ts";
import { MAX_MX_HOSTS } from "./limits.ts";
import type { All, Dmarc, Report, Spf, SpfTerm } from "./model.ts";
import {
  dkimKey,
  dmarcOf,
  isDmarc,
  isSpf,
  looksLikeDmarc,
  mxOf,
  parseSpf,
  reach,
  spfTerms,
  txtValue,
  type Mechanism,
  type Qualifier,
} from "./records.ts";

const TXT = 16;
const CNAME = 5;
const A = 1;

// Where providers usually put their DKIM keys.
export const SELECTORS = [
  "default",
  "dkim",
  "google",
  "selector1",
  "selector2",
  "fm1",
  "fm2",
  "fm3",
  "k1",
  "k2",
  "k3",
  "s1",
  "s2",
  "mail",
  "zoho",
  "protonmail",
  "protonmail2",
  "protonmail3",
  "mxvault",
];

// Past 10 lookups SPF breaks; counting stops a little after.
const COUNT_UP_TO = 30;
// The DMARC tree walk's parents have at most this many labels (DMARCbis).
const PARENT_LABELS = 7;

const texts = (a: DnsAnswer) =>
  a.records.filter((r) => r.type === TXT).map((r) => txtValue(r.data));

/** The names the DMARC tree walk asks, in order: the domain, then each
 * parent up to (not including) its top-level domain. From a longer name
 * the walk skips straight to its last seven labels, so it asks seven names
 * at most. */
export function dmarcNames(domain: string): string[] {
  const labels = domain.split(".");
  const names = [domain];
  const first = Math.max(1, labels.length - PARENT_LABELS);
  for (let i = first; i < labels.length - 1; i++) {
    names.push(labels.slice(i).join("."));
  }
  return names;
}

// What a record gives a sender it doesn't name: the qualifier of the
// first term that takes in every such sender, and that term.
interface Catch {
  qualifier: Qualifier;
  at: SpfTerm;
}

interface Count {
  lookups: number;
  unchecked: string[];
  uncheckedExists: string[];
  macros: string[];
  loop: boolean;
  all: All;
  allFrom: string | null;
  emptyRedirect: string | null;
  emptyInclude: string | null;
  syntax: SpfTerm | null;
  manyAt: string | null;
  // For a sender the record doesn't name, over IPv4 and over IPv6: what
  // the record (with everything it pulls in) gives them, or null when
  // nothing in it takes in every sender, so they fall through.
  v4: Catch | null;
  v6: Catch | null;
  wide: SpfTerm | null;
  senders: boolean;
}

const FAMILIES = ["v4", "v6"] as const;

export async function analyze(
  domain: string,
  resolve: Resolve,
  signal?: AbortSignal,
): Promise<Report | { missing: true }> {
  // Each name is asked once, however often the records pull it in. A
  // question that fails gives null: unchecked, never "nothing there". So
  // does one that was called off, so none is left rejecting with nobody
  // waiting on it; the check itself stops where it next looks at the signal.
  const asked = new Map<string, Promise<DnsAnswer | null>>();
  const ask = (name: string, type: RRType) => {
    const key = `${name.toLowerCase()} ${type}`;
    let answer = asked.get(key);
    if (!answer) {
      answer = resolve(name, type, signal).catch((error: unknown) => {
        if (
          error instanceof DnsError ||
          error instanceof TypeError ||
          signal?.aborted
        )
          return null;
        throw error;
      });
      asked.set(key, answer);
    }
    return answer;
  };

  // Everything that doesn't depend on another answer is asked at once.
  const own = Promise.all([ask(domain, "MX"), ask(domain, "TXT")]);
  const walk = Promise.all(
    dmarcNames(domain).map((n) => ask(`_dmarc.${n}`, "TXT")),
  );
  const sts = ask(`_mta-sts.${domain}`, "TXT");
  const tls = ask(`_smtp._tls.${domain}`, "TXT");
  const keys = Promise.all(
    SELECTORS.map(async (selector) => {
      const answer = await ask(`${selector}._domainkey.${domain}`, "TXT");
      if (!answer) return null;
      for (const v of texts(answer)) {
        const key = dkimKey(selector, v);
        if (key) return [key];
      }
      return [];
    }),
  );

  const [mxAnswer, txtAnswer] = await own;
  signal?.throwIfAborted();
  // Neither of the domain's own questions answered: the resolver's down.
  if (!mxAnswer && !txtAnswer) throw new DnsError("no answer");
  if (mxAnswer?.status === 3 && txtAnswer?.status === 3)
    return { missing: true };

  // The mail servers' names are asked about now, while SPF is counted.
  const mx = mxAnswer
    ? mxOf(mxAnswer.records.filter((r) => r.type === 15).map((r) => r.data))
    : ({ kind: "unchecked" } as const);
  const aliases =
    mx.kind === "hosts"
      ? Promise.all(mx.hosts.map((h) => ask(h.host, "CNAME")))
      : Promise.resolve([]);

  // SPF lookups, counted each time a name is met, as receivers count them.
  // `path` holds the names on the way down, to stop at a loop; `total`, the
  // lookups met so far anywhere, stops the walk once it's past the limit
  // (however wide the records branch).
  //
  // Alongside, the walk works out what the records give a sender they
  // don't name, as a receiver would evaluate them (RFC 7208, 4.6.2 and
  // 5): term by term, the first that takes in every sender decides. An
  // include takes them in when the record it pulls in passes them (5.2),
  // and then its own qualifier applies; a redirect applies only when
  // nothing before it decided (6.1). A term that breaks the syntax makes
  // the record broken, but the walk reads on past it, as some receivers
  // do: a +all after a mistake still counts as letting anyone send.
  let total = 0;
  const count = async (
    record: string,
    path: string[],
    here: string | null,
  ): Promise<Count> => {
    const terms = spfTerms(record);
    const parsed = parseSpf(record);
    total += terms.lookups;
    const out: Count = {
      lookups: terms.lookups,
      unchecked: [],
      uncheckedExists: [],
      macros: [],
      loop: false,
      all: terms.all,
      allFrom: null,
      emptyRedirect: null,
      emptyInclude: null,
      syntax: parsed.error === null ? null : { term: parsed.error, from: here },
      manyAt: null,
      v4: null,
      v6: null,
      wide: null,
      senders: false,
    };
    // The record a name holds, counted; "unchecked" when the lookup didn't
    // answer, null when there's nothing to read (a loop, no SPF record, or
    // past the limit).
    const follow = async (
      name: string,
      redirect: boolean,
    ): Promise<Count | "unchecked" | null> => {
      const key = name.toLowerCase();
      if (path.includes(key)) {
        out.loop = true;
        return null;
      }
      if (total > COUNT_UP_TO) return null;
      const answer = await ask(name, "TXT");
      if (!answer) {
        out.unchecked.push(name);
        return "unchecked";
      }
      const found = texts(answer).filter(isSpf);
      const [inner] = found;
      // An include or a redirect to a name with no SPF record: receivers
      // treat the record as broken (RFC 7208, 5.2 and 6.1). That's an
      // answer, unlike a lookup that failed.
      if (inner === undefined) {
        if (redirect) out.emptyRedirect = name;
        else out.emptyInclude ??= name;
        return null;
      }
      // More than one is broken as well (4.5); the first is still read.
      if (found.length > 1) out.manyAt ??= name;
      const sub = await count(inner, [...path, key], name);
      out.lookups += sub.lookups;
      out.unchecked.push(...sub.unchecked);
      out.uncheckedExists.push(...sub.uncheckedExists);
      out.macros.push(...sub.macros);
      out.loop ||= sub.loop;
      out.emptyRedirect ??= sub.emptyRedirect;
      out.emptyInclude ??= sub.emptyInclude;
      out.syntax ??= sub.syntax;
      out.manyAt ??= sub.manyAt;
      if (redirect) {
        out.all = sub.all;
        // Only the record that actually said it.
        out.allFrom = sub.all === null ? null : (sub.allFrom ?? name);
      }
      return sub;
    };
    const written = (m: Mechanism): SpfTerm => ({
      term: m.name === "all" ? `${m.qualifier}all` : m.text,
      from: here,
    });
    for (const m of parsed.mechanisms) {
      // Which senders still reach this term: those nothing before it took.
      const open = { v4: out.v4 === null, v6: out.v6 === null };
      const reached = open.v4 || open.v6;
      if (m.name === "include") {
        // A name with a macro in it is built for each sender (RFC 7208,
        // 7), so there's no one record to look up. It still costs its
        // lookup, and, unknown, it may name senders.
        if (m.target?.includes("%")) {
          if (!reached) continue;
          out.macros.push(m.text);
          out.senders ||= m.qualifier === "+";
          continue;
        }
        // Followed even when nothing reaches it: it still costs lookups.
        const sub = m.target === null ? null : await follow(m.target, false);
        if (!reached) continue;
        if (sub === "unchecked") {
          // Unknown: it may name senders.
          out.senders ||= m.qualifier === "+";
          continue;
        }
        if (sub === null) continue;
        for (const f of FAMILIES) {
          const inner = sub[f];
          if (open[f] && inner?.qualifier === "+") {
            out[f] = { qualifier: m.qualifier, at: inner.at };
          }
        }
        if (m.qualifier === "+") {
          out.senders ||= sub.senders;
          out.wide ??= sub.wide;
        }
        continue;
      }
      if (!reached) continue;
      const r = reach(m);
      // An exists term on a fixed name matches every sender when the name
      // has an address (an A record, whatever the sender's kind: RFC
      // 7208, 5.7), and nobody when it hasn't, so that's looked up. A
      // name with a macro in it can't be (the sender may pick it): it
      // still counts as letting anyone send.
      if (
        m.name === "exists" &&
        r.v4 === "anyone" &&
        m.target !== null &&
        !m.target.includes("%")
      ) {
        const answer = await ask(m.target, "A");
        if (!answer) {
          out.uncheckedExists.push(m.target);
          out.senders ||= m.qualifier === "+";
          continue;
        }
        // No address: it matches nobody, and names nobody.
        if (!answer.records.some((rr) => rr.type === A)) continue;
      }
      for (const f of FAMILIES) {
        if (open[f] && r[f] === "anyone") {
          out[f] = { qualifier: m.qualifier, at: written(m) };
        }
      }
      if (m.qualifier === "+" && m.name !== "all") {
        out.senders = true;
        if ((open.v4 && r.v4 === "wide") || (open.v6 && r.v6 === "wide")) {
          out.wide ??= written(m);
        }
      }
    }
    // A redirect to a name with a macro in it isn't looked up either.
    if (terms.redirect?.includes("%")) {
      out.macros.push(`redirect=${terms.redirect}`);
      out.senders = true;
    } else if (terms.redirect !== null) {
      const sub = await follow(terms.redirect, true);
      if (sub === "unchecked") out.senders = true;
      else if (sub !== null) {
        for (const f of FAMILIES) out[f] ??= sub[f];
        if (out.v4 === null || out.v6 === null) out.wide ??= sub.wide;
        out.senders ||= sub.senders;
      }
    }
    return out;
  };

  let spf: Spf;
  if (!txtAnswer) spf = { kind: "unchecked" };
  else {
    const found = texts(txtAnswer).filter(isSpf);
    const [first] = found;
    if (found.length > 1) spf = { kind: "many", count: found.length };
    else if (first === undefined) spf = { kind: "none" };
    else {
      const c = await count(first, [domain.toLowerCase()], null);
      const open =
        c.v4?.qualifier === "+"
          ? c.v4.at
          : c.v6?.qualifier === "+"
            ? c.v6.at
            : null;
      // The mx term asks for the domain's own mail servers, which are
      // already known: past ten of them it's a permerror (RFC 7208, 4.6.4).
      const ownMx = parseSpf(first).mechanisms.some(
        (m) =>
          m.name === "mx" &&
          (m.target === null || m.target.toLowerCase() === domain),
      );
      spf = {
        kind: "one",
        record: first,
        all: c.all,
        allFrom: c.allFrom,
        lookups: c.lookups,
        unchecked: [...new Set(c.unchecked)],
        uncheckedExists: [...new Set(c.uncheckedExists)],
        macros: [...new Set(c.macros)],
        loop: c.loop,
        emptyRedirect: c.emptyRedirect,
        emptyInclude: c.emptyInclude,
        ptr: spfTerms(first).ptr,
        syntax: c.syntax,
        manyAt: c.manyAt,
        open,
        wide: c.wide,
        senders: c.senders,
        mxOver:
          ownMx && mx.kind === "hosts" && mx.hosts.length > MAX_MX_HOSTS
            ? mx.hosts.length
            : null,
      };
    }
  }

  if (mx.kind === "hosts") {
    const answers = await aliases;
    mx.hosts.forEach((h, i) => {
      h.alias = answers[i]?.records.some((r) => r.type === CNAME) ?? false;
    });
  }

  // DMARC: the first name in the walk with a record. A name that didn't
  // answer before one that did leaves the policy unknown.
  const names = dmarcNames(domain);
  const answers = await walk;
  let dmarc: Dmarc = { kind: "none" };
  // A record that has v=DMARC1 but not first is ignored, and the walk goes
  // on; if it finds nothing else, the page says what it saw.
  let notFirst: string | undefined;
  for (const [i, answer] of answers.entries()) {
    if (!answer) {
      dmarc = { kind: "unchecked" };
      break;
    }
    const from = names[i] ?? domain;
    const values = texts(answer);
    if (values.some(isDmarc)) {
      dmarc = dmarcOf(values, from, i > 0);
      break;
    }
    if (notFirst === undefined && values.some(looksLikeDmarc)) notFirst = from;
  }
  if (dmarc.kind === "none" && notFirst !== undefined) {
    dmarc = { kind: "none", notFirst };
  }

  const found = await keys;
  const [stsAnswer, tlsAnswer] = await Promise.all([sts, tls]);
  signal?.throwIfAborted();
  return {
    domain,
    mx,
    spf,
    dkim: found.flatMap((k) => k ?? []),
    dkimUnchecked: found.filter((k) => k === null).length,
    dmarc,
    mtaSts: stsAnswer
      ? texts(stsAnswer).some((v) => /^v=STSv1/i.test(v))
      : null,
    tlsRpt: tlsAnswer
      ? texts(tlsAnswer).some((v) => /^v=TLSRPTv1/i.test(v))
      : null,
    dnssec: !!mxAnswer?.ad && !!txtAnswer?.ad,
  };
}
