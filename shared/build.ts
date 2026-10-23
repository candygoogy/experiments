// When and from which commit a tool was built, for the footer's stamp, as
// candygoogy.dev's src/lib/build.ts finds its own. Build time only. The
// commit comes from Workers Builds' environment (every deploy is a Workers
// Build of a push to the deploy branch), else from git. Without either the
// stamp shows just the date; the build never fails over it. A commit read
// from git, in a tree with uncommitted changes, is marked dirty: the build
// isn't that commit.
import { execSync } from "node:child_process";

export interface Build {
  /** The footer's ©, in UTC. */
  year: number;
  /** <time datetime>, in UTC: "2026-10-23". */
  iso: string;
  /** "Oct 23, 2026", in UTC, no time of day. */
  label: string;
  /** The full commit, lower case; none when no source had one. */
  commit?: string | undefined;
  /** Built from git with uncommitted changes. */
  dirty: boolean;
  /** One line on where the commit came from, or why none did. */
  note: string;
}

const SHA = /^[0-9a-f]{40}$/i;

const firstLine = (error: unknown) =>
  String(
    (error as { stderr?: Buffer }).stderr?.toString().trim() ||
      (error as Error).message ||
      error,
  ).split("\n")[0];

// Where the commit and the tree's state come from, passed in so the tests
// can stand in for each one.
export interface Sources {
  env: string | undefined;
  git: () => string;
  status: () => string;
}

const run = (command: string) => () =>
  execSync(command, { stdio: ["ignore", "pipe", "pipe"] }).toString();

const REAL: Sources = {
  env: process.env["WORKERS_CI_COMMIT_SHA"],
  git: run("git rev-parse HEAD"),
  status: run("git status --porcelain"),
};

export function buildStamp(
  now = new Date(),
  { env, git, status }: Sources = REAL,
): Build {
  const date = {
    year: now.getUTCFullYear(),
    iso: now.toISOString().slice(0, 10),
    label: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(now),
  };
  const misses: string[] = [];
  const found = (sha: string, source: string, dirty: boolean): Build => ({
    ...date,
    commit: sha.toLowerCase(),
    dirty,
    note:
      `build stamp: commit ${sha.slice(0, 7)} from ${source}` +
      (dirty ? ", uncommitted changes, marked dirty" : "") +
      (misses.length ? ` (${misses.join("; ")})` : ""),
  });

  const fromEnv = env?.trim();
  if (fromEnv && SHA.test(fromEnv)) {
    return found(fromEnv, "WORKERS_CI_COMMIT_SHA", false);
  }
  misses.push(`env ${fromEnv ? "not a SHA" : "empty"}`);

  try {
    const sha = git().trim();
    if (SHA.test(sha)) {
      let dirty = false;
      try {
        dirty = status().trim() !== "";
      } catch {
        // No status, no mark.
      }
      return found(sha, "git", dirty);
    }
    misses.push(`git gave "${sha}"`);
  } catch (error) {
    misses.push(`git: ${firstLine(error)}`);
  }

  return {
    ...date,
    dirty: false,
    note: `build stamp: no commit (${misses.join("; ")})`,
  };
}
