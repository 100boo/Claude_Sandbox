# CLAUDE.md: Narrator

Narrator (`apps/narrator/`, live at https://100boo.github.io/Claude_Sandbox/narrator/) reads downloaded books (mainly Royal Road EPUBs) aloud with on-device text-to-speech. The owner uses it on an iPhone, from the home screen. Product goal: **listen to web serials like audiobooks, reliably, for hours.**

The sandbox-wide rules in the root `CLAUDE.md` apply too, including **the repo is public**: never commit book content.

## Ground rules

- **No build step for the app.** `apps/narrator/` is deployed as-is. Plain ES2020 scripts loaded with `<script>` tags, with no bundler, framework or TypeScript. Keep it that way unless there's a strong reason (discuss first).
- **No runtime network dependencies.** Third-party libraries are vendored into `apps/narrator/vendor/` via `npm run vendor`, never loaded from a CDN. The app must work offline.
- **Books never leave the device.** No analytics, no uploads, no remote TTS without an explicit opt-in setting.
- **Tests must pass before committing:** `npm test && npm run test:e2e`. Add a unit test for every parser behavior change and an e2e test for every user-visible flow.

## Architecture

```
parsers.js  pure: file -> { title, author, format, cover, chapters: [{ title, paras: [string] }] }
search.js   pure: chapter matching (number/title) and full-text search with snippets
db.js       IndexedDB: meta (small, listed), content (chapters, loaded on open), inbox (share target)
app.js      UI + playback; exposes window.Narrator for debugging/tests
sw.js       stale-while-revalidate cache named sandbox/narrator/<APP_VERSION>; POST ./share-target -> inbox
```

- `parsers.js` and `db.js` are UMD-style: they attach to `self` in the browser and `module.exports` in Node. Tests load `parsers.js` through `tests/helpers/parsers.mjs`, which injects jsdom's `DOMParser` and JSZip. Don't use browser-only globals at module top level in `parsers.js`.
- **The book model is paragraphs.** Position is `{ ch, p }` (chapter index, paragraph index), and progress is computed from `meta.chapterLens`. Anything that changes how paragraphs are split changes saved positions for re-imported books. `makeMeta` clamps positions that fall out of range.
- **Re-import = update.** A book with the same title and author (case-insensitive) replaces the stored content but keeps `id`, `pos` and `addedAt`. This is how serial updates work. Don't break it.

### Playback loop (app.js `playLoop`)

- Paragraphs are split into chunks of ≤280 chars by `Parsers.splitForSpeech`, because long utterances stall or get cut off on some engines.
- Every start, stop or seek increments `state.token`. A loop exits as soon as its token is stale. **Never await speech without checking the token afterwards.**
- Pause is implemented as `cancel()` plus restarting the current chunk. `speechSynthesis.pause()` is unreliable on Android.
- `speakChunk` has a watchdog for engines that never fire `onend`, and the loop stops after 4 consecutive "silent" utterances so a broken engine can't fast-skip through a book.
- Background playback: a looping near-silent WAV (`#keepAliveAudio`) keeps Android treating the page as media and enables Media Session controls. On `visibilitychange` → visible, the loop restarts if the OS killed speech.

## Conventions

- **Bump `version.js` on every user-visible change.** It names the service-worker cache, and without a bump installed clients keep the old files. Use semver: patch for fixes, minor for features.
- If you add a file to `apps/narrator/`, also add it to `SHELL` in `sw.js` so it works offline.
- UI text: short and plain. Build DOM with `textContent` (book text is untrusted), never `innerHTML` with book data.
- Colors are CSS variables in `styles.css` `:root`, with a light-mode override. Don't hardcode colors elsewhere.
- Settings live in `localStorage` (`narrator.settings.v1`). Book data lives in IndexedDB. If you change a stored shape, bump the key or the DB version and write a migration.
- Commit messages: imperative summary line, then a body explaining why.

## Testing notes

- E2E tests (`tests/e2e/narrator.test.mjs`) replace `speechSynthesis` with a fake that records `window.__spoken`. Assert on what would be spoken, not on timing.
- Use Playwright `locator(..., { hasText }).waitFor()` rather than reading text right after a click. Opening books, importing and saving are async.
- `tests/helpers/epub.mjs` `makeEpub()` builds Royal Road-shaped EPUBs (one chapter per file, nav + NCX). Extend it rather than committing binary fixtures.
- Service workers are blocked in most e2e contexts. The offline test enables them explicitly.

## Roadmap

See `ROADMAP.md` in this folder. Keep it current: move items to "Done" with the version they shipped in.
