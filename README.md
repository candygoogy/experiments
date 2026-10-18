# experiments

Small tools that run in the browser, each on its own subdomain of [candygoogy.dev](https://candygoogy.dev). Every one does one thing and works on your device: what you drop, paste or type is read there and never uploaded. Six of the seven make no network calls at all, and their Content-Security-Policy sets `connect-src 'none'`, so the browser itself blocks any request. Mail check is the one exception, because its job is a DNS lookup (see below).

## The experiments

| Experiment     | Where                     | What it does                                                                                             |
| -------------- | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| Battery check  | `battery.candygoogy.dev`  | Drop in the report Windows makes about your battery, and get a plain answer on its health.               |
| Keyboard check | `keyboard.candygoogy.dev` | Press every key and watch it light up. Find the dead ones, the stuck ones, and the ones that type twice. |
| Photo check    | `photo.candygoogy.dev`    | Drop in a photo to see what it gives away, and get a clean copy without it.                              |
| Compose map    | `compose.candygoogy.dev`  | Paste a docker-compose file to see your services as a map, and what's exposed.                           |
| logscope       | `logscope.candygoogy.dev` | Drop a log from Windows or a server, and see what happened, grouped and explained.                       |
| Mail check     | `mail.candygoogy.dev`     | Type a domain to see how well its email is protected against fakes.                                      |
| Subnet planner | `subnet.candygoogy.dev`   | Type your network ranges to see them as a map, with the numbers worked out and the clashes named.        |

### What Mail check sends

Mail check asks Cloudflare's public DNS resolver (`cloudflare-dns.com`, the 1.1.1.1 service) over HTTPS for the records of the domain you type: its mail servers and SPF record, its DMARC record (`_dmarc.`, and its parent domains'), its DKIM keys under common selector names, and its MTA-STS and TLS reporting records. It then asks about the names those records point to: the mail servers' names, and the domains its SPF record includes or redirects to, and theirs in turn. Nothing else is sent, and its Content-Security-Policy allows `connect-src https://cloudflare-dns.com` and no other host.

## Layout

```text
shared/      tokens, base styles, fonts, the icons, the theme switch, the
             drop zone, the disclosure, the page shell and
             defineExperiment(), the Vite helper every experiment uses
template/    an empty experiment; `npm run new` copies it
scripts/     new.mjs
<name>/      one experiment: index.html, src/, wrangler.jsonc
```

Each experiment is plain TypeScript built with [Vite](https://vite.dev), and deployed as a static-assets Cloudflare Worker. `defineExperiment()` puts the shared header and footer into the page, inlines the small script that applies the saved theme before the first paint, and writes `dist/_headers` with the Content-Security-Policy (including that script's hash) and the other security headers, so the policy can't drift from the script.

## Develop

Requires Node 22.12 or newer.

```sh
npm ci
npx playwright install chromium  # once, for the browser checks
npm run dev -w @exp/template   # Vite dev server
npm run build                  # every experiment's dist/
npm run preview -w @exp/template  # serve dist/ with Wrangler, headers included
npm run lint                   # ESLint + Prettier check (never rewrites files)
npm run typecheck              # tsc
npm test                       # unit tests (Vitest), then browser checks (Playwright)
```

The browser checks serve each experiment's `dist/`, so run `npm run build` before `npm test`.

`npm run format` rewrites files with Prettier. It only runs when you call it.

### A new experiment

```sh
npm run new -- <name> <port>
```

copies `template/` to `<name>/`, renames it, and adds it to the workspaces. Wrangler serves it on `<port> + 10`. `node scripts/new.mjs --remove <name>` deletes it and takes it out of the workspaces again.

## Fonts

Headings are set in [Newsreader](https://github.com/productiontype/Newsreader) by Production Type, and body text and the wordmark in [Schibsted Grotesk](https://github.com/schibsted/schibsted-grotesk) by Schibsted Media Group. Both are under the [SIL Open Font License 1.1](https://openfontlicense.org), so the WOFF2 files are committed in `shared/fonts/`, each next to its license (`OFL-Newsreader.txt`, `OFL-SchibstedGrotesk.txt`). They're the same files candygoogy.dev serves, built there by `scripts/make-fonts.py` from the upstream files in google/fonts, pinned to one commit: Newsreader at one optical size, both cut to the weights and characters the sites use. Each experiment serves them from its own domain, and its `third-party-licenses.txt` carries both licenses.

## License

- **Code** is under the [MIT License](LICENSE).
- The **fonts** in `shared/fonts/` are under the SIL Open Font License 1.1 (see [Fonts](#fonts)).
- **Content** (the writing, images, logos and the candygoogy name and identity) is **© candygoogy, all rights reserved**. It isn't covered by the MIT License, so please don't reuse it without asking.
- The **avatar** artwork the site icon is made from is by [@dark_night1109](https://x.com/dark_night1109/status/2104328383211737219). It belongs to the artist and isn't covered by the © candygoogy content line or the MIT License.
