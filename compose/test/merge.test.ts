// A main file and its override, read as one the way Docker Compose merges
// them: the rules from its merge reference, one test each.
import { Window } from "happy-dom";
import { CORE_SCHEMA, loadAll, mergeTag } from "js-yaml";
import { describe, expect, test } from "vitest";
import { COPY, plain, say } from "../src/copy";
import { findings } from "../src/findings";
import { COMPOSE_TAGS, mergeDocuments } from "../src/merge";
import type { Service } from "../src/model";
import { parseCompose, partNames } from "../src/parse";
import { renderAnswer } from "../src/render";

const SCHEMA = CORE_SCHEMA.withTags(mergeTag, COMPOSE_TAGS);
const raw = (text: string) =>
  mergeDocuments(loadAll(text, { schema: SCHEMA })) as {
    services: Record<string, Record<string, unknown>>;
  };
const both = (base: string, override: string) => `${base}\n---\n${override}`;
const service = (text: string, name = "app"): Service => {
  const r = parseCompose(text);
  if (!("file" in r)) throw new Error(JSON.stringify(r));
  const s = r.file.services.find((x) => x.name === name);
  if (!s) throw new Error(name);
  return s;
};

const BASE = `services:
  app:
    image: app:1.0
    ports:
      - "8080:80"
    volumes:
      - data:/data
      - ./conf:/etc/app:ro
    environment:
      - MODE=prod
      - LEVEL=info
    depends_on:
      - db
    command: ["serve", "--fast"]
  db:
    image: postgres:16
volumes:
  data: {}
`;

describe("merging, rule by rule", () => {
  test("a single value is replaced, and one the override adds is kept", () => {
    const s = service(
      both(
        BASE,
        "services:\n  app:\n    image: app:2.0\n    restart: unless-stopped\n",
      ),
    );
    expect(s.image).toBe("app:2.0");
    expect(s.restart).toBe("unless-stopped");
  });

  test("an empty value in the override leaves the main file's alone", () => {
    const s = service(
      both(
        BASE.replace("    command", "    restart: always\n    command"),
        "services:\n  app:\n    restart:\n",
      ),
    );
    expect(s.restart).toBe("always");
  });

  test("ports are added, and the same port twice is one port", () => {
    const s = service(
      both(
        BASE,
        'services:\n  app:\n    ports:\n      - "8080:80"\n      - "127.0.0.1:9090:90"\n',
      ),
    );
    expect(
      s.ports.map((p) => `${p.hostIp ?? ""}|${p.published ?? ""}`),
    ).toEqual(["|8080", "127.0.0.1|9090"]);
  });

  test("volumes are merged by where they appear in the container", () => {
    const s = service(
      both(
        BASE,
        "services:\n  app:\n    volumes:\n      - other:/data\n      - ./logs:/logs\n",
      ),
    );
    expect(s.mounts.map((m) => `${m.source ?? ""}:${m.target}`)).toEqual([
      "other:/data",
      "./conf:/etc/app",
      "./logs:/logs",
    ]);
  });

  test("environment is merged by name, a list and a mapping alike", () => {
    const r = raw(
      both(
        BASE,
        "services:\n  app:\n    environment:\n      LEVEL: debug\n      EXTRA: x\n",
      ),
    );
    expect(r.services["app"]?.["environment"]).toEqual({
      MODE: "prod",
      LEVEL: "debug",
      EXTRA: "x",
    });
  });

  test("!reset null in environment removes that one variable", () => {
    // The compose spec's own example.
    const text = both(
      "services:\n  app:\n    image: a:1\n    environment:\n      FOO: bar\n      DB_PASSWORD: made-up-value\n",
      "services:\n  app:\n    environment:\n      FOO: !reset null\n",
    );
    expect(raw(text).services["app"]?.["environment"]).toEqual({
      DB_PASSWORD: "made-up-value",
    });
    expect(service(text).environment.map((e) => e.key)).toEqual([
      "DB_PASSWORD",
    ]);
  });

  test("!reset null in labels removes that one label", () => {
    const text = both(
      "services:\n  app:\n    image: a:1\n    labels:\n      - a=1\n      - b=2\n",
      "services:\n  app:\n    labels:\n      a: !reset null\n",
    );
    expect(raw(text).services["app"]?.["labels"]).toEqual({ b: "2" });
  });

  test("a name alone in the override's environment takes its value from the shell", () => {
    const text = both(
      "services:\n  app:\n    image: a:1\n    environment:\n      DB_PASSWORD: made-up-value\n",
      "services:\n  app:\n    environment:\n      - DB_PASSWORD\n",
    );
    expect(raw(text).services["app"]?.["environment"]).toEqual({
      DB_PASSWORD: null,
    });
    expect(service(text).environment).toEqual([
      { key: "DB_PASSWORD", literal: false, fileRef: false },
    ]);
  });

  test("depends_on is merged by service, a list and a mapping alike", () => {
    const s = service(
      both(
        BASE,
        "services:\n  app:\n    depends_on:\n      db:\n        condition: service_healthy\n      cache:\n        condition: service_started\n",
      ),
    );
    expect(s.dependsOn).toEqual([
      { service: "db", condition: "healthy" },
      { service: "cache", condition: "started" },
    ]);
  });

  test("command is replaced whole, never added to", () => {
    const r = raw(both(BASE, 'services:\n  app:\n    command: ["debug"]\n'));
    expect(r.services["app"]?.["command"]).toEqual(["debug"]);
  });

  test("other lists are added to, skipping repeats", () => {
    const r = raw(
      both(
        "services:\n  app:\n    image: a:1\n    cap_add: [NET_ADMIN]\n",
        "services:\n  app:\n    cap_add: [NET_ADMIN, SYS_TIME]\n",
      ),
    );
    expect(r.services["app"]?.["cap_add"]).toEqual(["NET_ADMIN", "SYS_TIME"]);
  });

  test("a service only in the override is added", () => {
    const s = service(
      both(BASE, "services:\n  cache:\n    image: redis:7\n"),
      "cache",
    );
    expect(s.image).toBe("redis:7");
  });

  test("!reset removes what the main file set", () => {
    const s = service(both(BASE, "services:\n  app:\n    ports: !reset []\n"));
    expect(s.ports).toEqual([]);
  });

  test("!override replaces it whole", () => {
    const s = service(
      both(
        BASE,
        'services:\n  app:\n    ports: !override\n      - "9000:80"\n',
      ),
    );
    expect(s.ports.map((p) => p.published)).toEqual(["9000"]);
  });

  test("the tags read alone, in one file, as their plain value", () => {
    const s = service(
      'services:\n  app:\n    image: a:1\n    ports: !override ["1:1"]\n    restart: !reset null\n',
    );
    expect(s.ports.map((p) => p.published)).toEqual(["1"]);
    expect(s.restart).toBeNull();
  });

  test("three files merge in order, each over the ones before", () => {
    const s = service(
      [
        BASE,
        "services:\n  app:\n    image: app:2\n",
        "services:\n  app:\n    image: app:3\n",
      ].join("\n---\n"),
    );
    expect(s.image).toBe("app:3");
  });
});

describe("keeping a port local, when an earlier file published it", () => {
  // An override's ports are added to the main file's, so writing
  // 127.0.0.1:8080:80 there leaves 8080:80 open as well.
  const advice = (text: string, name = "app") => {
    const r = parseCompose(text);
    if (!("file" in r)) throw new Error(JSON.stringify(r));
    const f = findings(r.file).find(
      (x) => x.rule === "openPorts" && x.service === name,
    );
    return f ? plain(say(f)) : null;
  };
  const MAIN =
    '# compose.yaml\nservices:\n  app:\n    image: nginx:1.27\n    restart: always\n    ports:\n      - "8080:80"\n';
  const LOCAL = "If only the server itself needs it";

  test("the override's port is added, so the advice says to replace the list there", () => {
    expect(
      advice(
        `${MAIN}---\n# compose.override.yaml\nservices:\n  app:\n    ports:\n      - "127.0.0.1:8080:80"\n`,
      ),
    ).toBe(
      "app is open to every device on your network on port 8080, and to the internet if your router forwards it. If only the server itself needs it (another container, or a reverse proxy on the same host), write 127.0.0.1:8080:80. In compose.override.yaml, that would add a port, not replace one: 8080:80 stays open. There, write ports: !override, then the whole list.",
    );
  });

  test("parts with no file names: an override file", () => {
    expect(
      advice(
        `${MAIN}---\nservices:\n  app:\n    environment:\n      - MODE=dev\n`,
      ),
    ).toContain(
      "write 127.0.0.1:8080:80. In an override file, that would add a port, not replace one: 8080:80 stays open. There, write ports: !override, then the whole list.",
    );
  });

  test("the last file that sets the service is the one named", () => {
    const said = advice(
      [
        MAIN,
        "# compose.test.yaml\nservices:\n  app:\n    restart: always\n",
        "# compose.override.yaml\nservices:\n  db:\n    image: postgres:16\n",
      ].join("---\n"),
    );
    expect(said).toContain("In compose.test.yaml, that would add a port");
  });

  test("a port only the last file writes: the advice for one file", () => {
    const said = advice(
      '# compose.yaml\nservices:\n  app:\n    image: nginx:1.27\n---\n# compose.override.yaml\nservices:\n  app:\n    ports:\n      - "8080:80"\n',
    );
    expect(said).toContain(LOCAL);
    expect(said).toMatch(/write 127\.0\.0\.1:8080:80\.$/);
  });

  test("an override that leaves the service alone: the advice for one file", () => {
    const said = advice(
      `${MAIN}---\n# compose.override.yaml\nservices:\n  db:\n    image: postgres:16\n`,
    );
    expect(said).toMatch(/write 127\.0\.0\.1:8080:80\.$/);
  });

  test("an override that already replaces the list: the advice for one file", () => {
    const said = advice(
      `${MAIN}---\n# compose.override.yaml\nservices:\n  app:\n    ports: !override\n      - "9090:80"\n`,
    );
    expect(said).toMatch(/write 127\.0\.0\.1:9090:80\.$/);
  });

  test("the same port written again in the override is the override's", () => {
    const said = advice(
      `${MAIN}---\n# compose.override.yaml\nservices:\n  app:\n    ports:\n      - "8080:80"\n`,
    );
    expect(said).toMatch(/write 127\.0\.0\.1:8080:80\.$/);
  });

  test("one file: the advice as it was", () => {
    expect(advice(MAIN)).toMatch(/write 127\.0\.0\.1:8080:80\.$/);
  });
});

describe("what can't go wrong", () => {
  test("a key named __proto__ is data, never the object's prototype", () => {
    const r = raw(
      both(
        "services:\n  app:\n    image: a:1\n",
        "services:\n  app:\n    environment:\n      __proto__: x\n",
      ),
    );
    const env = r.services["app"]?.["environment"] as Record<string, unknown>;
    expect(Object.keys(env)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(env)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
  });

  test("aliases that stand for a huge tree merge in time, or not at all", () => {
    // Nine levels of nine aliases: 9^9 leaves if every alias were copied,
    // in both documents, so merging them would walk every one.
    let text = "x-0: &m0 {a: 1, b: 2}\n";
    for (let i = 1; i <= 9; i++) {
      const keys = Array.from({ length: 9 }, (_, k) => `k${k}: *m${i - 1}`);
      text += `x-${i}: &m${i} {${keys.join(", ")}}\n`;
    }
    text += "x-big: *m9\nservices:\n  app:\n    image: a:1\n";
    const start = performance.now();
    const r = parseCompose(both(text, text));
    expect(performance.now() - start).toBeLessThan(1000);
    // Too much to merge: nothing to map, and the page stays responsive.
    expect(r).toEqual({ error: "empty" });
    // One document alone is read as before, however its aliases fan out.
    expect("file" in parseCompose(text)).toBe(true);
  });
});

describe("file names", () => {
  test("each document's name, from the line that opens it", () => {
    expect(
      partNames(
        "# docker-compose.yml\nservices:\n  a: {}\n---\n# docker-compose.override.yml\nservices:\n  a: {}\n",
      ),
    ).toEqual(["docker-compose.yml", "docker-compose.override.yml"]);
  });

  test("an ordinary comment isn't a name, and an empty document isn't counted", () => {
    expect(
      partNames(
        "# my stack\nservices:\n  a: {}\n---\n# only a comment\n---\nservices: {}\n",
      ),
    ).toEqual([null, null]);
  });

  test("the parsed file carries them, in order", () => {
    const r = parseCompose(
      "# compose.yaml\nservices:\n  a:\n    image: a:1\n---\n# compose.override.yaml\nservices:\n  a:\n    restart: always\n",
    );
    expect("file" in r && r.file.parts).toEqual([
      "compose.yaml",
      "compose.override.yaml",
    ]);
  });
});

describe("what the answer says about how it read the files", () => {
  const notes = (text: string, source: string | null = null) => {
    const r = parseCompose(text);
    if (!("file" in r)) throw new Error(JSON.stringify(r));
    const window = new Window();
    const { nodes } = renderAnswer(
      window.document as unknown as Document,
      r.file,
      "t",
      source,
    );
    const said = nodes
      .filter((n) => n.className === "note")
      .map((n) => n.textContent);
    void window.happyDOM.close();
    return said;
  };
  const MAIN = "# docker-compose.yml\nservices:\n  app:\n    image: a:1\n";
  const OVERRIDE =
    "# docker-compose.override.yml\nservices:\n  app:\n    restart: always\n";

  test("files merged: which, in order", () => {
    expect(notes(`${MAIN}---\n${OVERRIDE}`)).toEqual([
      "Read as one, the way Docker Compose merges them when you don’t pass -f: docker-compose.yml, then docker-compose.override.yml.",
    ]);
    expect(
      notes(
        "# compose.yaml\nservices:\n  app:\n    image: a:1\n---\n# compose.override.yaml\nservices:\n  app:\n    restart: always\n",
      ),
    ).toEqual([
      "Read as one, the way Docker Compose merges them when you don’t pass -f: compose.yaml, then compose.override.yaml.",
    ]);
    expect(
      notes(
        "services:\n  app:\n    image: a:1\n---\nservices: {app: {restart: always}}\n",
      ),
    ).toEqual([
      "Read as one, the way Docker Compose merges them: the two parts, top to bottom.",
    ]);
  });

  test("files Docker Compose merges only with -f: said so, and which it merges on its own", () => {
    const TEST =
      "# docker-compose.test.yml\nservices:\n  app:\n    image: a:2\n";
    expect(notes(`${MAIN}---\n${TEST}---\n${OVERRIDE}`)).toEqual([
      "Read as one, in this order: docker-compose.yml, then docker-compose.test.yml, then docker-compose.override.yml. Docker Compose merges them like this only when you pass each with -f. On its own, it reads just compose.yaml and compose.override.yaml, or docker-compose.yml and docker-compose.override.yml.",
    ]);
    expect(notes(`${MAIN}---\n${TEST}`)).toEqual([
      "Read as one, in this order: docker-compose.yml, then docker-compose.test.yml. Docker Compose merges them like this only when you pass each with -f. On its own, it reads just compose.yaml and compose.override.yaml, or docker-compose.yml and docker-compose.override.yml.",
    ]);
  });

  test("an override alone says what it is and what to do", () => {
    expect(notes(OVERRIDE)).toEqual([COPY.overrideOnly]);
  });

  test("a main file dropped alone: where its override would be", () => {
    expect(notes(MAIN, "docker-compose.yml")).toEqual([
      "If there’s a docker-compose.override.yml next to this file, Docker Compose merges it in: drop both together to see them as one.",
    ]);
    expect(notes(MAIN, "compose.yaml")).toEqual([
      COPY.overrideHint("compose.override.yaml"),
    ]);
    expect(notes(MAIN, "stack.yml")).toEqual([]);
    expect(notes(MAIN)).toEqual([]);
  });
});
