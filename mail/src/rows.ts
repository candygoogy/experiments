// Each check as a row: its level, and the sentence that says why. The most
// serious issue in a check is its main sentence and sets its level; the
// rest follow in the details. Level and sentence come from the same place,
// so a word like "Broken" always has its reason beside it.
import { LEVEL, NAMES, WORDS as W } from "./copy.ts";
import type { Report } from "./model.ts";
import { spfTerms } from "./records.ts";
import {
  anyoneSends,
  isShort,
  isTooShort,
  isUnusable,
  MAX_LOOKUPS,
  nobodySends,
  ownMailNeedsDkim,
  workingKeys,
  type Level,
} from "./verdict.ts";

export type RowId = keyof typeof NAMES;

export interface Row {
  id: RowId;
  name: string;
  level: Level;
  word: string;
  says: string;
  details: string[];
}

// One thing a check found, worst first within a row.
interface Issue {
  level: Level;
  says: string;
}

const RANK: Record<Level, number> = {
  unsafe: 6,
  broken: 5,
  missing: 4,
  unchecked: 3,
  weak: 2,
  info: 1,
  good: 0,
};

// The worst issue leads; the others, then the facts, are the details.
function row(id: RowId, issues: Issue[], facts: string[] = []): Row {
  const sorted = issues
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => RANK[b.issue.level] - RANK[a.issue.level] || a.i - b.i)
    .map(({ issue }) => issue);
  const [lead, ...rest] = sorted;
  const level = lead?.level ?? "info";
  return {
    id,
    name: NAMES[id],
    level,
    word: LEVEL[level],
    says: lead?.says ?? "",
    details: [...rest.map((r) => r.says), ...facts],
  };
}

export function rows(r: Report): Row[] {
  const out: Row[] = [];

  const { mx } = r;
  if (mx.kind === "unchecked")
    out.push(row("mx", [{ level: "unchecked", says: W.mxUnchecked }]));
  else if (mx.kind === "none")
    out.push(row("mx", [{ level: "missing", says: W.mxNone }]));
  else if (mx.kind === "null")
    out.push(row("mx", [{ level: "info", says: W.mxNull }]));
  else {
    out.push(
      row(
        "mx",
        [
          { level: "good", says: W.mxHosts(mx.hosts.length) },
          ...mx.hosts
            .filter((h) => h.alias)
            .map((h) => ({ level: "weak" as const, says: W.mxAlias(h.host) })),
          // RFC 7505 (3): a null MX must be the only one.
          ...(mx.nullToo
            ? [{ level: "weak" as const, says: W.mxNullToo }]
            : []),
        ],
        mx.hosts.map((h) => `${h.host} (${h.preference})`),
      ),
    );
  }

  const { spf } = r;
  // Under a policy that stops fakes, a missing or broken SPF record leaves
  // the domain's own mail to DKIM alone.
  const dkimOnly = ownMailNeedsDkim(r) ? [W.spfDkimOnly] : [];
  if (spf.kind === "unchecked")
    out.push(row("spf", [{ level: "unchecked", says: W.spfUnchecked }]));
  else if (spf.kind === "none")
    out.push(row("spf", [{ level: "missing", says: W.spfNone }], dkimOnly));
  else if (spf.kind === "many") {
    out.push(
      row("spf", [{ level: "broken", says: W.spfMany(spf.count) }], dkimOnly),
    );
  } else {
    const all = spf.all;
    const atLeast = spf.unchecked.length > 0;
    const over = spf.lookups > MAX_LOOKUPS;
    // A redirect that didn't answer, loops, leads nowhere, or depends on
    // the sender leaves the last word unknown, not missing. Only the
    // record's own redirect, and those it leads to: a record it includes
    // failing that way is a row of its own, not this record's last word.
    const redirectUnknown =
      all === null &&
      spfTerms(spf.record).redirect !== null &&
      spf.redirectUnknown;
    // A record with a mistake of its own says nothing receivers act on, so
    // its last word isn't offered as if it held.
    const ownMistake = spf.syntax !== null && spf.syntax.from === null;
    // What it says about everyone else. Anyone let in through any term
    // comes first, whatever the record's own last word is.
    const lastWord: Issue[] =
      spf.open !== null
        ? [{ level: "unsafe", says: W.spfOpen(spf.open) }]
        : redirectUnknown || ownMistake
          ? []
          : nobodySends(r)
            ? [{ level: "good", says: W.spfNobody }]
            : !spf.senders && !anyoneSends(r)
              ? [{ level: "missing", says: W.spfNoSenders }]
              : [
                  {
                    level:
                      all === "+"
                        ? "unsafe"
                        : all === "-" || all === "~"
                          ? "good"
                          : "weak",
                    says: W.spfAll[all ?? "none"],
                  },
                ];
    // A part that depends on the sender is a note, neither good nor bad.
    // Beside a last word it sits with the facts, so the row keeps its
    // level; without one it's the row's sentence.
    const macros = spf.macros.map(W.spfMacro);
    out.push(
      row(
        "spf",
        [
          ...lastWord,
          ...(spf.syntax !== null
            ? [{ level: "broken" as const, says: W.spfSyntax(spf.syntax) }]
            : []),
          ...(spf.manyAt !== null
            ? [{ level: "broken" as const, says: W.spfManyAt(spf.manyAt) }]
            : []),
          ...(spf.mxOver !== null
            ? [{ level: "broken" as const, says: W.spfMxOver(spf.mxOver) }]
            : []),
          ...(spf.loop ? [{ level: "broken" as const, says: W.spfLoop }] : []),
          ...(spf.emptyInclude !== null
            ? [
                {
                  level: "broken" as const,
                  says: W.spfEmptyInclude(spf.emptyInclude),
                },
              ]
            : []),
          ...(spf.emptyRedirect !== null
            ? [
                {
                  level: "broken" as const,
                  says: W.spfEmptyRedirect(spf.emptyRedirect),
                },
              ]
            : []),
          ...(over
            ? [
                {
                  level: "broken" as const,
                  says: W.spfTooMany(spf.lookups, atLeast),
                },
              ]
            : []),
          ...(atLeast && !over
            ? [
                {
                  level: "unchecked" as const,
                  says: W.spfUncheckedPart(spf.unchecked, spf.lookups),
                },
              ]
            : []),
          ...(spf.uncheckedExists.length
            ? [
                {
                  level: "unchecked" as const,
                  says: W.spfUncheckedExists(spf.uncheckedExists),
                },
              ]
            : []),
          ...(lastWord.length
            ? []
            : macros.map((says) => ({ level: "info" as const, says }))),
          ...(spf.wide !== null && spf.open === null
            ? [{ level: "weak" as const, says: W.spfWide(spf.wide) }]
            : []),
          ...(spf.ptr ? [{ level: "weak" as const, says: W.spfPtr }] : []),
        ],
        [
          ...dkimOnly,
          ...(spf.allFrom ? [W.spfAllFrom(spf.allFrom)] : []),
          ...(lastWord.length ? macros : []),
          ...(!over && !atLeast ? [W.spfLookups(spf.lookups)] : []),
          spf.record,
        ],
      ),
    );
  }

  // Keys receivers accept; keys too short for them to accept (under 1024
  // bits) or that they can't use at all; and, among the accepted, keys
  // shorter than recommended.
  const working = workingKeys(r);
  const tooShort = r.dkim.filter(isTooShort);
  const unusable = r.dkim.filter(isUnusable);
  const dkimIssues: Issue[] = [
    ...(working.length
      ? [
          {
            level: "good" as const,
            says: W.dkimFound(working.map((k) => k.selector)),
          },
          ...working.filter(isShort).map((k) => ({
            level: "weak" as const,
            says: W.dkimShort(k.selector, k.bits ?? 0),
          })),
        ]
      : []),
    ...tooShort.map((k) => ({
      level: working.length ? ("weak" as const) : ("broken" as const),
      says: W.dkimTooShort(k.selector, k.bits ?? 0),
    })),
    ...unusable.map((k) => ({
      level: working.length ? ("weak" as const) : ("broken" as const),
      says:
        k.unusable === "kind"
          ? W.dkimKind(k.selector, k.keyType)
          : W.dkimBad(k.selector),
    })),
  ];
  // Several large services don't check Ed25519 signatures yet.
  const edOnly =
    working.length > 0 && working.every((k) => k.keyType === "ed25519");
  if (!dkimIssues.length) {
    dkimIssues.push({
      level: "info",
      says: r.dkim.length
        ? W.dkimWithdrawn(r.dkim.map((k) => k.selector))
        : nobodySends(r)
          ? W.dkimNotNeeded
          : W.dkimNone,
    });
  }
  out.push(
    row("dkim", dkimIssues, [
      ...(edOnly ? [W.dkimEd25519Only] : []),
      ...r.dkim.map(W.dkimKey),
      ...(r.dkimUnchecked ? [W.dkimUnchecked(r.dkimUnchecked)] : []),
    ]),
  );

  const { dmarc } = r;
  // Whose policy it is, when it's a parent's (the DMARC tree walk).
  const from =
    dmarc.kind !== "none" &&
    dmarc.kind !== "unchecked" &&
    dmarc.from !== r.domain
      ? [W.dmarcFrom(dmarc.from)]
      : [];
  if (dmarc.kind === "unchecked")
    out.push(row("dmarc", [{ level: "unchecked", says: W.dmarcUnchecked }]));
  else if (dmarc.kind === "none") {
    out.push(
      row("dmarc", [
        dmarc.notFirst === undefined
          ? { level: "missing", says: W.dmarcNone }
          : { level: "broken", says: W.dmarcNotFirst },
      ]),
    );
  } else if (dmarc.kind === "many") {
    out.push(
      row("dmarc", [{ level: "broken", says: W.dmarcMany(dmarc.count) }], from),
    );
  } else if (dmarc.invalid !== null || dmarc.policy === null) {
    // No usable policy: receivers act as if it said p=none when it asks
    // for reports, and ignore it when it doesn't (RFC 7489, 6.6.3).
    out.push(
      row(
        "dmarc",
        [
          {
            level: "broken",
            says:
              dmarc.invalid !== null
                ? W.dmarcInvalid(dmarc.invalid, dmarc.reports)
                : W.dmarcNoPolicy(dmarc.reports),
          },
        ],
        [...from, dmarc.reports ? W.dmarcReports : W.dmarcNoReports],
      ),
    );
  } else {
    const enforced = dmarc.policy !== "none";
    const partial = dmarc.pct < 100 && enforced;
    const own = dmarc.from === r.domain;
    // Subdomains left open while the domain itself is protected.
    const openBelow = own && enforced && dmarc.subdomains === "none";
    out.push(
      row(
        "dmarc",
        [
          partial
            ? { level: "weak", says: W.dmarcPartial(dmarc.policy, dmarc.pct) }
            : {
                level: enforced ? "good" : "weak",
                says: W.dmarcPolicy[dmarc.policy],
              },
          ...(openBelow
            ? [{ level: "weak" as const, says: W.dmarcSubNone }]
            : []),
          // SPF that lets anyone send lets every fake pass DMARC: the
          // policy never applies.
          ...(enforced && anyoneSends(r)
            ? [
                {
                  level: "unsafe" as const,
                  says: W.dmarcBypassed(
                    (r.spf.kind === "one" ? r.spf.open : null) ?? {
                      term: "+all",
                      from: null,
                    },
                  ),
                },
              ]
            : []),
        ],
        [
          ...from,
          ...(own &&
          !openBelow &&
          dmarc.subdomains &&
          dmarc.subdomains !== dmarc.policy
            ? [W.dmarcSubdomains(dmarc.subdomains)]
            : []),
          dmarc.reports ? W.dmarcReports : W.dmarcNoReports,
        ],
      ),
    );
  }

  out.push(
    row(
      "extras",
      [{ level: "info", says: r.dnssec ? W.dnssec : W.noDnssec }],
      [
        r.mtaSts === null
          ? W.mtaStsUnchecked
          : r.mtaSts
            ? W.mtaSts
            : W.noMtaSts,
        r.tlsRpt === null
          ? W.tlsRptUnchecked
          : r.tlsRpt
            ? W.tlsRpt
            : W.noTlsRpt,
      ],
    ),
  );
  return out;
}
