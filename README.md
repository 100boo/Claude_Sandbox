# App sandbox

Small apps built with Claude, each one installable on a phone's home screen straight from the web. There's no app store and nothing to download.

> **This is a public repository.** Don't commit personal information, secrets or copyrighted content. App data (like your books) stays on your phone and never goes into this repo.

**Open the launcher:** https://100boo.github.io/Claude_Sandbox/

| App | What it does | Link |
|---|---|---|
| Narrator | Listen to downloaded books (EPUB, TXT, HTML) read aloud | [open](https://100boo.github.io/Claude_Sandbox/narrator/) · [docs](apps/narrator/README.md) |
| Grove | Log trees with photos and location on a map of where you've explored | [open](https://100boo.github.io/Claude_Sandbox/trees/) · [docs](apps/trees/README.md) |

## Put an app on your iPhone home screen

1. Open the app's link in **Safari**.
2. Tap **Share** (the square with an up arrow), then **Add to Home Screen**, then **Add**.
3. From then on, open it from the home-screen icon. It runs full screen and works offline.

Add each app from its own page, not from the launcher, so the icon opens that app. On Android, use Chrome: **⋮ → Install app**.

## Development

```bash
npm install
npm run dev        # all apps at http://localhost:8080 (launcher at /, then /narrator/, /trees/)
npm test           # unit tests
npm run test:e2e   # browser tests at phone size (run `npx playwright install chromium` once)
```

Every push to `main` publishes `apps/` to GitHub Pages. [CLAUDE.md](CLAUDE.md) has the repo layout, the rules every app follows, and the checklist for adding a new one.
