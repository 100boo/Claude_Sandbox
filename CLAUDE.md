# CLAUDE.md: the app sandbox

This repo is the owner's sandbox for small apps that Claude builds and maintains. Each app is a static web app (PWA) the owner opens on their **iPhone** and adds to the home screen. There's no app store and nothing to download. Claude is the main contributor.

Live site: https://100boo.github.io/Claude_Sandbox/ shows a launcher page listing every app. Each app lives at `…/Claude_Sandbox/<app-id>/`.

## ⚠️ This repository is PUBLIC

Everything committed here (code, docs, commit messages, issues, PR text, workflow logs) is visible to anyone on the internet, including in git history after deletion. Never commit:

- personal information about the owner (name, email, location, accounts, phone, device details)
- API keys, tokens, passwords, `.env` files or any other secret
- books, chapter text, or other copyrighted content
- anything the owner describes as private or sensitive

If a task needs any of that, stop and ask the owner where it should go instead (somewhere other than this repo). Commits are authored as `Claude <noreply@anthropic.com>`. Keep it that way so no personal email ends up in history.

## Layout

```
apps/                  the published site (deployed as-is, minus *.md files)
  index.html           launcher page; reads apps.json
  apps.json            registry: [{ id, name, description, icon, cachePrefix }]
  sw.js                one-time cleanup for the old root-level Narrator install (no app registers it)
  narrator/            Narrator: books read aloud (see apps/narrator/CLAUDE.md)
  trees/               Grove: log trees with photos on a personal map (see apps/trees/CLAUDE.md)
scripts/               dev server (serves all of apps/), icon renderer, vendoring
tests/unit/            node:test unit tests (registry checks + per-app tests)
tests/e2e/             Playwright tests (launcher + per-app)
tests/helpers/         shared test helpers
```

## Rules for every app

- **Self-contained folder** `apps/<id>/`. The folder name is the URL (`/<id>/`), so never rename a folder once the owner may have installed it, with no build step and plain scripts. Libraries are vendored into `apps/<id>/vendor/` via `scripts/vendor.mjs`, never loaded from a CDN.
- **Relative URLs only** (`./`, `icons/x.png`), never `/…`. The site is served under `/Claude_Sandbox/`.
- **All apps share one origin** (`100boo.github.io`), so they share Cache Storage, IndexedDB and localStorage. Namespace everything:
  - service-worker caches: start with the app's `cachePrefix` from `apps.json` (new apps use `sandbox/<id>/`; Grove keeps its original `grove-`), and a worker deletes only caches with its own prefix
  - IndexedDB database names and localStorage keys start with `<id>`
  - never register a service worker outside the app's own folder
- **iPhone first.** Test at iPhone size (Playwright `devices['iPhone 15']`). Include `apple-touch-icon` (180px PNG, no transparency), `apple-mobile-web-app-capable`, `apple-mobile-web-app-title` and `viewport-fit=cover` with safe-area padding.
- `manifest.webmanifest` uses `"scope": "./"` and `"start_url": "./"`.
- User data stays on the device unless the owner explicitly asks otherwise.
- **Tests must pass before committing:** `npm test && npm run test:e2e`. `tests/unit/apps-registry.test.mjs` checks every app folder against these rules.

## Adding a new app

1. Create `apps/<id>/` with `index.html`, `manifest.webmanifest`, `icons/` (`npm run icons -- <id>` renders PNGs from `icons/icon.svg`), and optionally `sw.js` + `version.js` for offline use (copy Narrator's pattern).
2. Add an entry to `apps/apps.json` (include `cachePrefix` if it has a service worker).
3. Add tests under `tests/unit/` and `tests/e2e/`, and an `apps/<id>/CLAUDE.md` with that app's notes.
4. Push to `main`. It's live in about a minute. Give the owner the link `https://100boo.github.io/Claude_Sandbox/<id>/` and remind them to use Share → Add to Home Screen **from the app's own page**.

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml`, which publishes `apps/` to GitHub Pages. CI (`ci.yml`) runs all tests on every push and checks that vendored files match `package.json`.

The `github-pages` environment only allows deploys from `main`. If a deploy fails within seconds with no step logs, check that environment's deployment-branch rule (Settings → Environments). The workflow isn't the problem.

Develop on a feature branch, then push to `main` when tests pass. The owner has authorised pushing to `main`.

## Dev tooling

Node 20+. `npm run dev` serves `apps/` at http://localhost:8080. `playwright` is pinned to 1.63.0 to match the browser preinstalled in the cloud dev container. Bump it only together with the CI browser install.
