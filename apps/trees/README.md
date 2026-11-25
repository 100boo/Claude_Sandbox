# Grove

A mobile-first web app for logging trees you've seen: take or choose a photo, note what kind of tree it is, and save it with your location. Everything you log builds a personal map of the places you've explored.

- **Log a tree:** photo (camera or gallery), name, notes, location. Location comes from your phone's GPS, from the photo's own GPS data if it has any, or from a tap on the map. A visit with no photo or name works too.
- **Your map:** each tree is a photo pin. "Fog" covers everything you haven't explored and clears a circle around each spot (radius adjustable in the menu). The header counts trees, species and places.
- **List:** every entry, newest first, with a filter. Tap one to see it on the map.
- **Private by default:** photos and locations stay in this browser's storage (IndexedDB). Photos are re-encoded on save, which strips their hidden metadata. The only network traffic is map tiles from OpenStreetMap, which reveals which area you're viewing.
- **Backup:** Menu → Export backup saves a JSON file with all entries and photos; Import backup restores or merges one. Clearing the browser's site data deletes your trees, so export now and then.
- **Offline:** installs as a PWA. The app works offline, and map areas you've already viewed stay available.

## Develop

```sh
npm install
npm run dev                 # http://localhost:8080/trees/
npm test                    # unit tests (tests/unit/trees-geo.test.mjs)
npm run test:e2e            # includes tests/e2e/trees.test.mjs
npm run icons -- trees      # re-render icons from icons/icon.svg
```

Same rules as the rest of the repo: no build step, Leaflet is vendored into `vendor/` by `npm run vendor`, bump `version.js` on every user-visible change, and add new files to `SHELL` in `sw.js`.

Live at https://100boo.github.io/Claude_Sandbox/trees/ (listed on the launcher). Geolocation and the camera need HTTPS, so test on the deployed URL from a phone.
