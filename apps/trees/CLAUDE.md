# CLAUDE.md: Grove

Grove (`apps/trees/`, live at https://100boo.github.io/Claude_Sandbox/trees/) lets the owner log trees with a photo, name and notes, saved with location, on a personal map with a "fog" layer that clears where they've been. See `README.md` in this folder.

The sandbox-wide rules in the root `CLAUDE.md` apply. The folder stays `trees/` (not `grove/`) because that's the address the app was first published at.

- No build step, plain scripts. Leaflet is vendored into `vendor/` by `npm run vendor`. Bump `version.js` on every user-visible change, and add new files to `SHELL` in `sw.js`.
- Pure helpers live in `geo.js` (UMD, unit-tested in `tests/unit/trees-geo.test.mjs`). Storage is in `db.js` (IndexedDB `grove`).
- Service-worker caches are `grove-<version>` plus `grove-tiles-v1` for OpenStreetMap tiles (the only network use). It only deletes `grove-*` caches.
- **Never commit real photos or real coordinates** (the repo is public). `tests/helpers/exif.mjs` builds synthetic EXIF for tests. Photos are re-encoded on save, which strips EXIF.
