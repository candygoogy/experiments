// The edges: which values count as written
// out, what a key may show, host paths and Docker's socket, how a
// random port reads, wires that share a trunk, and two false alarms.
import { Window } from "happy-dom";
import { describe, expect, test } from "vitest";
import { plain, say } from "../src/copy";
import { findings, type Finding } from "../src/findings";
import { layout } from "../src/layout";
import { renderMap } from "../src/map";
import type { ComposeFile } from "../src/model";
import { literal, parseCompose } from "../src/parse";
import { renderAnswer } from "../src/render";

const parsed = (yml: string): ComposeFile => {
  const p = parseCompose(yml);
  if (!("file" in p)) throw new Error(JSON.stringify(p));
  return p.file;
};
const sentences = (yml: string) =>
  findings(parsed(yml)).map((f) => plain(say(f)));
const rules = (yml: string): Finding["rule"][] =>
  findings(parsed(yml)).map((f) => f.rule);
const env = (lines: string) =>
  `services:\n  db:\n    image: postgres:16\n    restart: always\n    environment:\n${lines}`;

/** The answer as the page draws it, in happy-dom, as HTML. */
function drawn(yml: string): string {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const { nodes } = renderAnswer(doc, parsed(yml), "yours");
  const html = nodes.map((n) => n.outerHTML).join("");
  void window.happyDOM.close();
  return html;
}

describe("written out, or drawn from a variable", () => {
  test.each([
    ["hunter2", true],
    ["${DB_PASSWORD}", false],
    ["$DB_PASSWORD", false],
    ["x$DB_PASSWORD", false],
    ["${DB_PASSWORD:-hunter2}", true],
    ["${DB_PASSWORD-hunter2}", true],
    ["${DB_PASSWORD:-}", false],
    ["${DB_PASSWORD:-${OTHER}}", false],
    // A default inside a default is still written out; text beside a
    // variable in a default is not a whole value.
    ["${A:-${B:-hunter2}}", true],
    ["${A:-x${B}}", false],
    // The text after ? is the error shown when the variable is missing.
    ["${DB_PASSWORD:?set DB_PASSWORD}", false],
    ["$$literal", true],
    ["", false],
    [null, false],
  ] as [string | null, boolean][])("%s → %s", (value, expected) => {
    expect(literal(value)).toBe(expected);
  });

  test("a 200,000-character value is read in well under 50 ms", () => {
    const value = "${A:-".repeat(40_000);
    const start = performance.now();
    expect(literal(value)).toBe(false);
    expect(performance.now() - start).toBeLessThan(50);
  });

  test.each([
    [
      "      spring.datasource.password: hunter2\n",
      "spring.datasource.password",
    ],
    ["      - DB-PASSWORD=hunter2\n", "DB-PASSWORD"],
  ])("a dotted or dashed name is still a name: %s", (line, key) => {
    const said = sentences(env(line)).join(" ");
    expect(said).toContain(`${key}=•••• written in the file`);
    expect(said).not.toContain("hunter2");
  });

  test("$VAR is a variable, not a secret in the file", () => {
    expect(rules(env("      POSTGRES_PASSWORD: $DB_PASSWORD\n"))).not.toContain(
      "secrets",
    );
  });

  test("a secret written as a variable's default is in the file (and masked)", () => {
    const said = sentences(
      env("      - POSTGRES_PASSWORD=${DB_PASSWORD:-hunter2}\n"),
    );
    expect(said.join(" ")).toContain(
      "POSTGRES_PASSWORD=•••• written in the file",
    );
    expect(said.join(" ")).not.toContain("hunter2");
  });

  test("a *_FILE variable, or a path under /run/secrets, is the safe way", () => {
    expect(
      rules(env("      POSTGRES_PASSWORD_FILE: /run/secrets/db_password\n")),
    ).not.toContain("secrets");
    expect(rules(env("      - DB_PASSWORD=/run/secrets/db\n"))).not.toContain(
      "secrets",
    );
  });
});

describe("a key shows its name and nothing after it", () => {
  // A file that once leaked a value through its key, kept as a test.
  const LEAK =
    'services:\n  weird:\n    image: w:1\n    restart: always\n    environment:\n      "API_KEY=sk-live-123": "x"\n';

  test("only the name before the first =", () => {
    const said = sentences(LEAK).join(" ");
    expect(said).toContain("weird has API_KEY=•••• written in the file");
    expect(said).not.toContain("sk-live");
  });

  test("the value never reaches the page: not in text, not in attributes", () => {
    const html = drawn(LEAK);
    expect(html).toContain("API_KEY=••••");
    expect(html).not.toContain("sk-live");
  });

  test("a key that isn't a variable name isn't shown at all", () => {
    const html = drawn(env('      "PASS WORD: hunter2": "x"\n'));
    expect(html).not.toContain("hunter2");
    expect(html).not.toContain("PASS WORD");
  });
});

describe("host folders, and Docker's own socket", () => {
  const vol = (line: string) =>
    `services:\n  t:\n    image: traefik:3\n    restart: always\n    volumes:\n      - ${line}\n`;

  test.each([
    "${XDG_RUNTIME_DIR}/docker.sock:/var/run/docker.sock",
    "/run/user/1000/podman/podman.sock:/var/run/docker.sock",
    "//./pipe/docker_engine://./pipe/docker_engine",
    "/var/run/docker.sock:/var/run/docker.sock:ro",
  ])("%s controls Docker", (line) => {
    expect(rules(vol(line))).toContain("socket");
  });

  test.each(["${HOME}/data", "$HOME/data", "~/data", "./data", "../data"])(
    "%s is a host folder, not a named volume",
    (source) => {
      const [mount] = parsed(vol(`${source}:/data`)).services[0]?.mounts ?? [];
      expect(mount).toMatchObject({ kind: "bind", source });
    },
  );

  test("a colon inside ${…} doesn't split the volume", () => {
    const [mount] =
      parsed(vol("${DATA_DIR:-./data}:/data:ro")).services[0]?.mounts ?? [];
    expect(mount).toEqual({
      kind: "bind",
      source: "${DATA_DIR:-./data}",
      target: "/data",
      readOnly: true,
    });
    const [drive] =
      parsed(vol("${DIR:-C:/data}:/data")).services[0]?.mounts ?? [];
    expect(drive).toMatchObject({ source: "${DIR:-C:/data}", target: "/data" });
    // The drive letter's colon still isn't a separator.
    const [win] = parsed(vol("C:\\games:/games:ro")).services[0]?.mounts ?? [];
    expect(win).toMatchObject({
      kind: "bind",
      source: "C:\\games",
      target: "/games",
      readOnly: true,
    });
  });

  test("Docker's socket under a variable with a default controls Docker", () => {
    expect(
      rules(
        vol(
          "${XDG_RUNTIME_DIR:-/run/user/1000}/docker.sock:/var/run/docker.sock",
        ),
      ),
    ).toContain("socket");
  });

  test("a variable alone is whatever it's set to, shown as such", () => {
    const file = parsed(
      "services:\n  t:\n    image: a:1\n    restart: always\n    volumes:\n      - ${VOL_NAME}:/data\n      - $VOL:/x\n      - ${HOME}/data:/home\n      - pgdata:/var/lib\n",
    );
    expect(file.services[0]?.mounts.map((m) => m.kind)).toEqual([
      "variable",
      "variable",
      "bind",
      "volume",
    ]);
    const html = drawn(
      "services:\n  t:\n    image: a:1\n    restart: always\n    volumes:\n      - ${VOL_NAME}:/data\n      - ${HOME}/data:/home\n",
    );
    expect(html).toContain(
      '<span class="kind">Set by</span> ${VOL_NAME} at /data',
    );
    expect(html).toContain(
      '<span class="kind">Host</span> ${HOME}/data at /home',
    );
  });

  test("a plain name is still a named volume", () => {
    const [mount] = parsed(vol("data:/data")).services[0]?.mounts ?? [];
    expect(mount).toMatchObject({ kind: "volume", source: "data" });
  });

  test("the long syntax's named pipe", () => {
    const file = parsed(
      "services:\n  t:\n    image: a:1\n    restart: always\n    volumes:\n      - type: npipe\n        source: \\\\.\\pipe\\docker_engine\n        target: \\\\.\\pipe\\docker_engine\n",
    );
    expect(findings(file).map((f) => f.rule)).toContain("socket");
  });
});

describe("how ports read", () => {
  // What a screen reader hears: every bit of text, in order, but what's
  // hidden from it.
  const heard = (node: Node): string =>
    node.nodeType === 3
      ? (node.textContent ?? "")
      : (node as Element).getAttribute?.("aria-hidden") === "true"
        ? ""
        : [...node.childNodes].map(heard).join("");
  const map = (yml: string) => {
    const window = new Window();
    const root = renderMap(
      window.document as unknown as Document,
      parsed(yml),
      "t",
    );
    const out = {
      shown: [...root.querySelectorAll(".port")].map((p) =>
        [...p.querySelectorAll("[aria-hidden=true]")]
          .map((n) => n.textContent)
          .join(""),
      ),
      read: [...root.querySelectorAll(".svc .line")].map((l) =>
        heard(l as unknown as Node)
          .replace(/\s+/g, " ")
          .trim(),
      ),
    };
    void window.happyDOM.close();
    return out;
  };

  test("a published port with no host port: random port → 80, and Docker picks it", () => {
    const m = map(
      'services:\n  web:\n    image: nginx:1\n    restart: always\n    ports:\n      - "80"\n',
    );
    expect(m.shown[0]).toBe("random port → 80");
    expect(m.read[0]).toContain(
      "open to your network on a host port Docker picks, for port 80",
    );
  });

  test("tags and ports are read apart, and local is said once", () => {
    const m = map(
      'services:\n  web:\n    image: nginx:1\n    restart: always\n    privileged: true\n    ports:\n      - "8080:80"\n      - "127.0.0.1:8443:443"\n',
    );
    expect(m.read[0]).toBe(
      "web, nginx:1, privileged, open to your network on port 8080, open to the server only on port 8443",
    );
  });
});

describe("wires out of one service share a trunk", () => {
  test("150 services waiting for db: one lane", () => {
    let yml = "services:\n  db:\n    image: db:1\n    restart: always\n";
    for (let i = 0; i < 150; i++) {
      yml += `  s${i}:\n    image: s:1\n    restart: always\n    depends_on: [db]\n`;
    }
    const plan = layout(parsed(yml));
    expect(plan.wires).toHaveLength(150);
    expect(plan.lanes).toBe(1);
  });

  test("a gateway waiting for 30 services: one trunk into it", () => {
    let yml = "services:\n";
    for (let i = 0; i < 30; i++)
      yml += `  d${i}:\n    image: d:1\n    restart: always\n`;
    yml += `  gw:\n    image: g:1\n    restart: always\n    depends_on: [${Array.from({ length: 30 }, (_, i) => `d${i}`).join(", ")}]\n`;
    const plan = layout(parsed(yml));
    expect(plan.wires).toHaveLength(30);
    expect(plan.lanes).toBe(1);
  });

  test("a wire joins the bigger bundle: fan-out and fan-in side by side", () => {
    // db is waited for by three; gw waits for three (db among them).
    let yml = "services:\n  db:\n    image: d:1\n";
    for (const s of ["a", "b"])
      yml += `  ${s}:\n    image: s:1\n    depends_on: [db]\n`;
    for (const s of ["x", "y"]) yml += `  ${s}:\n    image: s:1\n`;
    yml += "  gw:\n    image: g:1\n    depends_on: [db, x, y]\n";
    const plan = layout(parsed(yml));
    expect(plan.wires).toHaveLength(5);
    // Two trunks: db's (a, b and gw) and gw's (x and y).
    expect(plan.lanes).toBe(2);
    const lanesOf = (rows: number[]) =>
      new Set(
        plan.wires.filter((w) => rows.includes(w.from)).map((w) => w.lane),
      );
    expect(lanesOf([0]).size).toBe(1);
  });
});

describe("two false alarms", () => {
  test("a service built here names its image: no latest", () => {
    expect(
      rules(
        "services:\n  app:\n    build: .\n    image: myapp\n    restart: always\n",
      ),
    ).not.toContain("latest");
  });

  test("deploy's restart_policy is a restart policy", () => {
    expect(
      rules(
        "services:\n  app:\n    image: a:1\n    deploy:\n      restart_policy:\n        condition: on-failure\n",
      ),
    ).not.toContain("noRestart");
    expect(
      rules(
        "services:\n  app:\n    image: a:1\n    deploy:\n      restart_policy:\n        condition: none\n",
      ),
    ).toContain("noRestart");
  });
});

describe("a service behind a profile", () => {
  const DEBUG = `services:
  dbg:
    image: a:1
    restart: always
    profiles: [debug]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
  web:
    image: b:1
    restart: always
`;

  test("its findings stay, and say it runs only with that profile", () => {
    expect(sentences(DEBUG)).toEqual([
      "dbg can control Docker itself through /var/run/docker.sock, which means the whole host. dbg runs only when the debug profile is turned on.",
    ]);
  });

  test("with two profiles, either one starts it", () => {
    const text = DEBUG.replace("[debug]", "[debug, test]");
    expect(sentences(text)[0]).toMatch(
      / dbg runs only when the debug or test profile is turned on\.$/,
    );
  });

  test("a finding about several services notes only the one behind a profile", () => {
    const text = DEBUG.replaceAll("    restart: always\n", "");
    expect(sentences(text).at(-1)).toBe(
      "dbg and web have no restart policy, so they won’t come back after a reboot. dbg runs only when the debug profile is turned on.",
    );
  });

  test("its row on the map says so", () => {
    const window = new Window();
    const map = renderMap(
      window.document as unknown as Document,
      parsed(DEBUG),
      "t",
    );
    const tags = [...map.querySelectorAll(".svc")].map((row) =>
      [...row.querySelectorAll(".tag")].map((t) => t.textContent),
    );
    expect(tags).toEqual([
      ["controls Docker", "only with the debug profile"],
      [],
    ]);
    void window.happyDOM.close();
  });
});
