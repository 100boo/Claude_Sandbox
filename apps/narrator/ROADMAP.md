# Roadmap

Priorities come from the core goal: listen to Royal Road serials for hours, screen off, without fiddling.

## Next

1. **Native wrapper for real background playback.** Wrap `apps/narrator/` with Capacitor and replace `speechSynthesis` with the platform TTS (Android `TextToSpeech`, iOS `AVSpeechSynthesizer`) behind the same `speakChunk` interface, plus a foreground media service (Android) or audio background mode (iOS). This fixes screen-off playback on iPhone and makes Android rock-solid. The web build stays as a fallback.
2. **Test on real devices.** Check background behavior on a recent Android/Chrome and iOS/Safari, and record the results in the README table.
3. **Pronunciation fixes.** A per-book find/replace list (e.g. "HP" → "health points", character names), applied at speak time.
4. **Skip author's notes.** Royal Road chapters often start or end with "A/N" or "Author's note" blocks. Add an optional filter.

## Later

- Export a chapter or book to audio files (needs native TTS `synthesizeToFile`, or an opt-in cloud voice).
- Optional neural/cloud voices (opt-in, user-supplied API key, with an offline cache of generated audio).
- Bookmarks and a "recently heard" rewind (go back 30 seconds' worth of text).
- Library search and sort, plus series grouping.
- Backup/restore of library and positions to a file.
- Mini-player in the library so audio keeps going while you browse.
- Multi-chapter-per-file EPUBs where the TOC points at `#anchors` within one document.

## Done

- **0.1.1:** moved to `/narrator/` in the multi-app sandbox; service-worker caches namespaced per app.

- **0.1.0:** PWA with EPUB/TXT/HTML/Markdown import, paste text, chapter detection, Royal Road anti-piracy notice filter, paragraph-level resume, serial re-import keeps position, speed/voice/pitch, sleep timer, Media Session controls, background keep-alive (Android), wake lock option, offline service worker, Android share target, desktop file handler.
