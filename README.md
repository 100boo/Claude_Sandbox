# Narrator

Turn the stories you download (Royal Road EPUBs, text files, saved web pages) into audiobooks on your phone.

> **This is a public repository.** Don't commit personal information, secrets or book content. Your books live only on your phone, never in this repo.

Narrator is an installable web app (PWA). It reads books aloud with your phone's built-in text-to-speech voices, works offline, and keeps everything on your device. Nothing is uploaded anywhere.

## Features

- **Formats:** EPUB, TXT, HTML and Markdown. You can also paste text directly.
- **Chapters:** detected from the EPUB table of contents, headings, or "Chapter 12…" lines in plain text.
- **Remembers your place** in every book, down to the paragraph.
- **Serial-friendly:** re-import an updated download of a story you're following and it adds the new chapters without losing your place.
- **Royal Road cleanup:** skips the hidden "this story was stolen from Royal Road" notices that end up in downloaded chapters, and scene-break lines like `* * *`.
- **Player:** play/pause, skip by paragraph or chapter, scrub within a chapter, tap any paragraph to start reading there, speed 0.5×–3×, voice and pitch choice, and an option to announce chapter titles.
- **Sleep timer:** 15/30/45/60 minutes, or stop at the end of the chapter.
- **Lock-screen and headphone controls** (Media Session).
- **Android share sheet:** share a downloaded file to Narrator to import it.
- Light and dark themes that follow your phone.

## Install it on your phone

1. Open the app's URL (see [Hosting](#hosting) below) in **Chrome on Android** or **Safari on iPhone**.
2. Add it to your home screen:
   - **Android (Chrome):** ⋮ menu → **Install app** (or **Add to Home screen**).
   - **iPhone (Safari):** Share button → **Add to Home Screen**.
3. Open Narrator from the home screen, tap **+ Import books**, and pick your downloads.

**Better voices:** the app uses whatever voices your phone has installed. Higher-quality ones are free:
- **Android:** Settings → Accessibility → Text-to-speech → Preferred engine (Google), then ⚙ → Install voice data.
- **iPhone:** Settings → Accessibility → Spoken Content → Voices → English. The "Enhanced" and "Premium" voices sound much better.

Then pick the voice in Narrator → ⚙ Settings → Voice.

## Getting books from Royal Road

Narrator works with any EPUB, so use whatever download tool you prefer. Downloads with one chapter per file (the usual layout) get clean chapter names.

Royal Road's terms only allow downloading for personal offline reading. Please keep it that way, and support the authors you listen to.

## Known limitations

Browser text-to-speech was built for short phrases, not hours of narration. In practice:

| | Screen on | Screen off / app in background |
|---|---|---|
| Android (Chrome) | ✅ | ⚠️ Usually keeps going with "Keep playing in background" on. If it stops, it picks up again when you come back to the app. |
| iPhone (Safari) | ✅ | ❌ iOS pauses web speech when the screen locks. |

Workaround on either platform: turn on **Settings → Keep screen on while playing** and turn your screen brightness down.

The real fix is a native wrapper that uses the phone's speech engine directly. That's the top item on the [roadmap](docs/ROADMAP.md).

## Hosting

The app is plain static files in [`app/`](app/), with no build step. Any static host works.

**GitHub Pages (set up already):** [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) publishes `app/` on every push to `main`. One-time setup: repo **Settings → Pages → Source: GitHub Actions**. The site will be at `https://<your-username>.github.io/<repo-name>/`.

> GitHub Pages on a **private** repo needs a paid GitHub plan. On a free plan, either make the repo public (your books are never in the repo, they stay on your phone) or drop the `app/` folder onto Netlify or Cloudflare Pages.

HTTPS is required for install, offline mode and the share sheet. All the hosts above provide it.

## Development

Needs Node 20+.

```bash
npm install
npm run dev          # serves app/ at http://localhost:8080 (also prints a LAN URL)
npm test             # parser unit tests (Node + jsdom)
npm run test:e2e     # drives the real app in headless Chromium at phone size
npm run icons        # re-render PNG icons from app/icons/icon.svg
npm run vendor       # copy JSZip from node_modules into app/vendor
```

For the end-to-end tests, run `npx playwright install chromium` once.

Project layout:

```
app/                 the deployable PWA (no build step)
  index.html         markup for all screens and sheets
  styles.css         theme tokens + layout (dark/light)
  app.js             UI, playback loop, media session, sleep timer
  parsers.js         EPUB/HTML/TXT/MD → { title, author, chapters[{title, paras[]}] }
  db.js              IndexedDB storage (shared with the service worker)
  sw.js              offline cache + Android share-target handler
  version.js         APP_VERSION, which also names the offline cache
  vendor/jszip.min.js
tests/unit/          parser tests
tests/e2e/           browser tests with a fake speech engine
tests/helpers/       EPUB fixture builder, Node loader for parsers.js
scripts/             dev server, icon renderer, vendoring
docs/ROADMAP.md      what's next
```

See [CLAUDE.md](CLAUDE.md) for architecture notes and contribution conventions.
