/* Grove: log trees you've seen, with photos and location, on a personal map. */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const SETTINGS_KEY = 'grove.settings.v1';
  const PHOTO_MAX = 1600; // px, long edge of stored photos
  const THUMB_MAX = 320;

  const settings = Object.assign({ fog: true, radius: 150, view: null }, readSettings());
  const state = {
    entries: [],
    thumbUrls: new Map(), // photo id -> object URL of its thumbnail
    markers: L.layerGroup(),
    form: null, // the log/edit form while it is open
    picking: false,
    detailId: null,
    detailUrls: [],
  };

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  }

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const titleOf = (e) => e.species || (e.photoCount ? 'Unnamed tree' : 'Visited place');

  function el(tag, props = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of children) if (c) n.append(c);
    return n;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function thumbUrl(photo) {
    let u = state.thumbUrls.get(photo.id);
    if (!u) { u = URL.createObjectURL(photo.thumb); state.thumbUrls.set(photo.id, u); }
    return u;
  }
  function forgetThumbs(entry) {
    for (const p of entry.photos || []) {
      const u = state.thumbUrls.get(p.id);
      if (u) { URL.revokeObjectURL(u); state.thumbUrls.delete(p.id); }
    }
  }

  /* ---------------- Map ---------------- */

  const map = L.map('map', { zoomControl: false, worldCopyJump: true, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    crossOrigin: true, // CORS responses can be cached by the service worker without opaque-size padding
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  state.markers.addTo(map);

  // Darkens everything except a soft circle around each logged spot.
  const FogLayer = L.Layer.extend({
    onAdd(m) {
      this._canvas = L.DomUtil.create('canvas', 'fog-layer leaflet-zoom-hide');
      m.getPanes().overlayPane.appendChild(this._canvas);
      m.on('move zoomend resize viewreset', this._schedule, this);
      this._draw();
    },
    onRemove(m) {
      m.off('move zoomend resize viewreset', this._schedule, this);
      this._canvas.remove();
    },
    redraw() { if (this._map) this._schedule(); },
    _schedule() {
      if (this._frame) return;
      this._frame = requestAnimationFrame(() => { this._frame = 0; this._draw(); });
    },
    _draw() {
      const m = this._map, c = this._canvas;
      if (!m || !c) return;
      const size = m.getSize(), dpr = window.devicePixelRatio || 1;
      c.width = size.x * dpr; c.height = size.y * dpr;
      c.style.width = size.x + 'px'; c.style.height = size.y + 'px';
      L.DomUtil.setPosition(c, m.containerPointToLayerPoint([0, 0]));
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--fog').trim() || 'rgba(20,30,24,.55)';
      ctx.fillRect(0, 0, size.x, size.y);
      ctx.globalCompositeOperation = 'destination-out';
      const zoom = m.getZoom();
      for (const e of state.entries) {
        const p = m.latLngToContainerPoint([e.lat, e.lng]);
        const mpp = (40075016.686 * Math.cos((e.lat * Math.PI) / 180)) / (256 * 2 ** zoom);
        const r = Math.max(8, settings.radius / mpp);
        if (p.x < -r || p.y < -r || p.x > size.x + r || p.y > size.y + r) continue;
        const g = ctx.createRadialGradient(p.x, p.y, r * 0.55, p.x, p.y, r);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  });
  const fog = new FogLayer();

  let hereMarker = null, hereCircle = null;
  function showHere(lat, lng, accuracy) {
    if (!hereMarker) {
      hereMarker = L.circleMarker([lat, lng], { radius: 7, className: 'here-dot', interactive: false }).addTo(map);
      hereCircle = L.circle([lat, lng], { radius: accuracy || 0, className: 'here-acc', interactive: false }).addTo(map);
    } else {
      hereMarker.setLatLng([lat, lng]);
      hereCircle.setLatLng([lat, lng]).setRadius(accuracy || 0);
    }
  }

  function renderMarkers() {
    state.markers.clearLayers();
    for (const e of state.entries) {
      let icon;
      if (e.photos && e.photos.length) {
        const img = el('img', { src: thumbUrl(e.photos[0]), alt: '' });
        icon = L.divIcon({ className: 'pin pin-photo', html: img, iconSize: [46, 46], iconAnchor: [23, 23] });
      } else {
        icon = L.divIcon({ className: 'pin pin-dot', html: el('span'), iconSize: [22, 22], iconAnchor: [11, 11] });
      }
      const mk = L.marker([e.lat, e.lng], { icon, title: titleOf(e), keyboard: true, riseOnHover: true });
      mk.on('click', () => { if (!state.picking) openDetail(e.id); });
      mk.entryId = e.id;
      state.markers.addLayer(mk);
    }
  }

  function renderStats() {
    const s = Geo.stats(state.entries, settings.radius);
    $('#stats').textContent = s.entries
      ? [plural(s.trees, 'tree'), s.species && plural(s.species, 'species', 'species'), plural(s.places, 'place')].filter(Boolean).join(' · ')
      : 'Nothing logged yet';
  }

  function renderSpeciesOptions() {
    $('#speciesList').replaceChildren(...Geo.speciesList(state.entries).map((s) => el('option', { value: s })));
  }

  function renderAll() {
    renderMarkers();
    renderStats();
    renderSpeciesOptions();
    renderList();
    fog.redraw();
  }

  async function reload() {
    state.entries = await GroveDB.listEntries();
    renderAll();
  }

  function locate() {
    if (!navigator.geolocation) { toast('Location is not available on this device'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        showHere(lat, lng, accuracy);
        map.flyTo([lat, lng], Math.max(map.getZoom(), 16));
      },
      (err) => toast(locError(err)),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 },
    );
  }
  const locError = (err) => (err && err.code === 1 ? 'Location permission is off' : "Couldn't get your location");

  /* ---------------- Sheets ---------------- */

  function openSheet(id) {
    const d = $(id);
    if (!d.open) d.showModal();
  }
  function closeSheet(id) {
    const d = $(id);
    if (d.open) d.close();
  }
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-close]')) { d.close(); return; }
      // A tap on the backdrop (outside the sheet's box) closes it too.
      const r = d.getBoundingClientRect();
      const outside = ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
      if (ev.target === d && outside && ev.detail) d.close();
    });
  }

  /* ---------------- Log / edit form ---------------- */

  function openLog(entry) {
    discardForm();
    state.form = {
      id: entry ? entry.id : uid(),
      existing: entry || null,
      photos: entry ? entry.photos.map((p) => ({ id: p.id, thumb: p.thumb, url: thumbUrl(p), saved: true })) : [],
      newPhotos: [],
      loc: entry ? { lat: entry.lat, lng: entry.lng, accuracy: entry.accuracy, source: entry.locSource || 'device' } : null,
      takenAt: null,
    };
    $('#logTitle').textContent = entry ? 'Edit' : 'Log a tree';
    $('#speciesInput').value = entry ? entry.species || '' : '';
    $('#notesInput').value = entry ? entry.notes || '' : '';
    renderForm();
    openSheet('#logSheet');
    if (!entry) requestFormLocation(false);
  }

  function discardForm() {
    const f = state.form;
    if (!f) return;
    for (const p of f.photos) if (!p.saved) URL.revokeObjectURL(p.url);
    state.form = null;
  }

  function renderForm() {
    const f = state.form;
    if (!f) return;
    $('#photoStrip').replaceChildren(...f.photos.map((p) => el('div', { class: 'thumb' }, [
      el('img', { src: p.url, alt: 'Tree photo' }),
      el('button', {
        type: 'button', class: 'thumb-x', 'aria-label': 'Remove photo', text: '✕',
        onclick: () => {
          f.photos = f.photos.filter((x) => x !== p);
          f.newPhotos = f.newPhotos.filter((x) => x.id !== p.id);
          if (!p.saved) URL.revokeObjectURL(p.url);
          renderForm();
        },
      }),
    ])));
    const loc = f.loc;
    const src = { device: 'your location', photo: 'the photo', map: 'the map' };
    $('#locText').textContent = loc
      ? `${Geo.formatCoord(loc.lat, loc.lng)}${loc.accuracy ? ` ±${Math.round(loc.accuracy)} m` : ''} · from ${src[loc.source] || 'your location'}`
      : f.locError || 'Getting your location…';
    $('#saveBtn').disabled = !loc || f.busy;
  }

  function setFormLoc(loc) {
    if (!state.form) return;
    state.form.loc = loc;
    state.form.locError = null;
    renderForm();
  }

  function requestFormLocation(force) {
    const f = state.form;
    if (!navigator.geolocation) { f.locError = 'Location not available. Pick it on the map.'; renderForm(); return; }
    if (force) { f.loc = null; f.locError = null; renderForm(); }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (state.form !== f) return;
        // A location from a photo or a map tap was a deliberate choice: keep it.
        if (!force && f.loc && f.loc.source !== 'device') return;
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        showHere(lat, lng, accuracy);
        setFormLoc({ lat, lng, accuracy, source: 'device' });
      },
      (err) => {
        if (state.form !== f || f.loc) return;
        f.locError = `${locError(err)}. Pick it on the map.`;
        renderForm();
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 },
    );
  }

  async function decodeImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function resize(src, max, quality) {
    const w = src.width, h = src.height;
    const s = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    // Re-encoding also strips EXIF, so stored photos carry no hidden metadata.
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality));
  }

  async function addPhotos(files) {
    const f = state.form;
    if (!f || !files.length) return;
    f.busy = true;
    renderForm();
    let failed = 0;
    for (const file of files) {
      try {
        const exif = Geo.readExif(await file.arrayBuffer());
        const img = await decodeImage(file);
        const [blob, thumb] = await Promise.all([resize(img, PHOTO_MAX, 0.85), resize(img, THUMB_MAX, 0.8)]);
        if (img.close) img.close();
        if (state.form !== f) return;
        const id = uid();
        f.photos.push({ id, thumb, url: URL.createObjectURL(thumb), saved: false });
        f.newPhotos.push({ id, blob });
        if (exif && exif.lat != null && (!f.loc || f.loc.source === 'device')) {
          setFormLoc({ lat: exif.lat, lng: exif.lng, accuracy: null, source: 'photo' });
        }
        if (exif && exif.takenAt && !f.existing && !f.takenAt) f.takenAt = exif.takenAt;
      } catch {
        failed++;
      }
    }
    f.busy = false;
    renderForm();
    if (failed) toast(failed === 1 ? "Couldn't read that image" : `Couldn't read ${failed} images`);
  }

  async function saveForm() {
    const f = state.form;
    if (!f || !f.loc || f.busy) return;
    const now = Date.now();
    const entry = {
      id: f.id,
      createdAt: f.existing ? f.existing.createdAt : (f.takenAt && f.takenAt < now ? f.takenAt : now),
      updatedAt: now,
      lat: f.loc.lat,
      lng: f.loc.lng,
      accuracy: f.loc.accuracy ?? null,
      locSource: f.loc.source,
      species: $('#speciesInput').value.trim(),
      notes: $('#notesInput').value.trim(),
      photos: f.photos.map((p) => ({ id: p.id, thumb: p.thumb })),
    };
    f.busy = true;
    renderForm();
    try {
      await GroveDB.saveEntry(entry, f.newPhotos.filter((p) => entry.photos.some((x) => x.id === p.id)));
    } catch (err) {
      f.busy = false;
      renderForm();
      toast(err && err.name === 'QuotaExceededError' ? 'Storage is full' : "Couldn't save");
      return;
    }
    if (f.existing) forgetThumbs(f.existing);
    for (const p of f.photos) if (!p.saved) URL.revokeObjectURL(p.url);
    state.form = null;
    closeSheet('#logSheet');
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    await reload();
    map.flyTo([entry.lat, entry.lng], Math.max(map.getZoom(), 16));
    toast(f.existing ? 'Updated' : 'Saved');
  }

  function startPick() {
    state.picking = true;
    closeSheet('#logSheet');
    $('#pickBanner').hidden = false;
    document.body.classList.add('picking');
    if (state.form.loc) map.panTo([state.form.loc.lat, state.form.loc.lng]);
  }
  function endPick() {
    state.picking = false;
    $('#pickBanner').hidden = true;
    document.body.classList.remove('picking');
    openSheet('#logSheet');
  }

  map.on('click', (ev) => {
    if (!state.picking) return;
    setFormLoc({ lat: ev.latlng.lat, lng: L.Util.wrapNum(ev.latlng.lng, [-180, 180], true), accuracy: null, source: 'map' });
    endPick();
  });

  // Closing the sheet any way other than "pick on map" throws the draft away.
  $('#logSheet').addEventListener('close', () => { if (!state.picking) discardForm(); });

  /* ---------------- Detail ---------------- */

  function openDetail(id) {
    const e = state.entries.find((x) => x.id === id);
    if (!e) return;
    for (const u of state.detailUrls) URL.revokeObjectURL(u);
    state.detailUrls = [];
    state.detailId = id;
    $('#detailTitle').textContent = titleOf(e);
    $('#detailPhotos').replaceChildren(...e.photos.map((p) => {
      const img = el('img', { src: thumbUrl(p), alt: titleOf(e) });
      GroveDB.getPhoto(p.id).then((blob) => {
        if (!blob || state.detailId !== id) return;
        const u = URL.createObjectURL(blob);
        state.detailUrls.push(u);
        img.src = u;
      });
      return img;
    }));
    $('#detailPhotos').hidden = !e.photos.length;
    const nearby = state.entries.filter((x) => x.id !== id && Geo.distance(x, e) <= settings.radius).length;
    $('#detailMeta').textContent = [
      fmtDate(e.createdAt),
      Geo.formatCoord(e.lat, e.lng) + (e.accuracy ? ` ±${Math.round(e.accuracy)} m` : ''),
      nearby ? `${plural(nearby, 'other entry', 'other entries')} nearby` : '',
    ].filter(Boolean).join(' · ');
    $('#detailNotes').textContent = e.notes || '';
    openSheet('#detailSheet');
  }

  $('#detailSheet').addEventListener('close', () => {
    for (const u of state.detailUrls) URL.revokeObjectURL(u);
    state.detailUrls = [];
    state.detailId = null;
  });

  $('#editBtn').addEventListener('click', () => {
    const e = state.entries.find((x) => x.id === state.detailId);
    closeSheet('#detailSheet');
    if (e) openLog(e);
  });

  $('#deleteBtn').addEventListener('click', async () => {
    const e = state.entries.find((x) => x.id === state.detailId);
    if (!e || !confirm(`Delete “${titleOf(e)}”? This can't be undone.`)) return;
    await GroveDB.deleteEntry(e.id);
    forgetThumbs(e);
    closeSheet('#detailSheet');
    await reload();
    toast('Deleted');
  });

  /* ---------------- List ---------------- */

  function renderList() {
    const q = $('#filterInput').value.trim().toLowerCase();
    const items = [...state.entries]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((e) => !q || `${e.species} ${e.notes}`.toLowerCase().includes(q));
    $('#entryList').replaceChildren(...items.map((e) => el('li', {}, [
      el('button', {
        class: 'entry',
        onclick: () => {
          closeSheet('#listSheet');
          map.flyTo([e.lat, e.lng], Math.max(map.getZoom(), 16));
          openDetail(e.id);
        },
      }, [
        e.photos.length ? el('img', { src: thumbUrl(e.photos[0]), alt: '' }) : el('span', { class: 'entry-ph', text: '🌳' }),
        el('span', { class: 'entry-text' }, [
          el('b', { text: titleOf(e) }),
          el('small', { text: `${fmtDate(e.createdAt)}${e.photoCount > 1 ? ` · ${e.photoCount} photos` : ''}${e.notes ? ` · ${e.notes}` : ''}` }),
        ]),
      ]),
    ])));
    $('#emptyMsg').hidden = state.entries.length > 0;
  }

  /* ---------------- Backup ---------------- */

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  async function exportBackup() {
    toast('Preparing backup…');
    const entries = [];
    for (const e of await GroveDB.listEntries()) {
      const photos = [];
      for (const p of e.photos) {
        const full = await GroveDB.getPhoto(p.id);
        photos.push({ id: p.id, thumb: await blobToDataUrl(p.thumb), full: full ? await blobToDataUrl(full) : null });
      }
      entries.push({ ...e, photos });
    }
    const data = JSON.stringify({ app: 'grove', format: 1, exportedAt: new Date().toISOString(), entries });
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = el('a', { href: url, download: `grove-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function importBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch { data = null; }
    if (!data || data.app !== 'grove' || !Array.isArray(data.entries)) { toast("That isn't a Grove backup"); return; }
    const toBlob = async (u) => (typeof u === 'string' && u.startsWith('data:image/') ? (await fetch(u)).blob() : null);
    let n = 0;
    for (const raw of data.entries) {
      if (!raw || typeof raw.id !== 'string' || !Geo.validLatLng(Number(raw.lat), Number(raw.lng))) continue;
      const photos = [], newPhotos = [];
      for (const p of Array.isArray(raw.photos) ? raw.photos : []) {
        const thumb = await toBlob(p && p.thumb);
        if (!thumb || typeof p.id !== 'string') continue;
        photos.push({ id: p.id, thumb });
        const full = await toBlob(p.full);
        newPhotos.push({ id: p.id, blob: full || thumb });
      }
      const old = state.entries.find((x) => x.id === raw.id);
      if (old) forgetThumbs(old);
      await GroveDB.saveEntry({
        id: raw.id,
        createdAt: Number(raw.createdAt) || Date.now(),
        updatedAt: Number(raw.updatedAt) || Date.now(),
        lat: Number(raw.lat),
        lng: Number(raw.lng),
        accuracy: Number.isFinite(raw.accuracy) ? raw.accuracy : null,
        locSource: ['device', 'photo', 'map'].includes(raw.locSource) ? raw.locSource : 'device',
        species: String(raw.species || '').slice(0, 200),
        notes: String(raw.notes || '').slice(0, 5000),
        photos,
      }, newPhotos);
      n++;
    }
    await reload();
    fitAll();
    toast(`Imported ${plural(n, 'entry', 'entries')}`);
  }

  /* ---------------- Wiring ---------------- */

  function fitAll() {
    if (!state.entries.length) return;
    const b = L.latLngBounds(state.entries.map((e) => [e.lat, e.lng]));
    map.fitBounds(b.pad(0.2), { maxZoom: 16 });
  }

  $('#logBtn').addEventListener('click', () => openLog(null));
  $('#listBtn').addEventListener('click', () => { renderList(); openSheet('#listSheet'); });
  $('#menuBtn').addEventListener('click', () => openSheet('#menuSheet'));
  $('#locateBtn').addEventListener('click', locate);
  $('#cameraInput').addEventListener('change', (ev) => { addPhotos([...ev.target.files]); ev.target.value = ''; });
  $('#photoInput').addEventListener('change', (ev) => { addPhotos([...ev.target.files]); ev.target.value = ''; });
  $('#locHereBtn').addEventListener('click', () => requestFormLocation(true));
  $('#locPickBtn').addEventListener('click', startPick);
  $('#pickCancel').addEventListener('click', endPick);
  $('#logForm').addEventListener('submit', (ev) => { ev.preventDefault(); saveForm(); });
  $('#filterInput').addEventListener('input', renderList);
  $('#exportBtn').addEventListener('click', () => exportBackup().catch(() => toast("Couldn't export")));
  $('#importInput').addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (file) { closeSheet('#menuSheet'); importBackup(file).catch(() => toast("Couldn't import that file")); }
  });

  $('#fogToggle').checked = settings.fog;
  $('#fogToggle').addEventListener('change', (ev) => {
    settings.fog = ev.target.checked;
    saveSettings();
    if (settings.fog) fog.addTo(map); else fog.remove();
  });
  const showRadius = () => { $('#radiusVal').textContent = settings.radius >= 1000 ? '1 km' : `${settings.radius} m`; };
  $('#radiusInput').value = settings.radius;
  showRadius();
  $('#radiusInput').addEventListener('input', (ev) => {
    settings.radius = Number(ev.target.value) || 150;
    saveSettings();
    showRadius();
    renderStats();
    fog.redraw();
  });
  $('#versionText').textContent = self.APP_VERSION;

  map.on('moveend', () => {
    const c = map.getCenter();
    settings.view = { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
    saveSettings();
  });

  async function init() {
    const v = settings.view;
    if (v && Geo.validLatLng(v.lat, v.lng)) map.setView([v.lat, v.lng], v.zoom);
    else map.setView([20, 0], 2);
    if (settings.fog) fog.addTo(map);
    await reload();
    if (!v) fitAll();
  }

  window.Grove = { state, settings, map, reload };
  window.Grove.ready = init().catch((err) => { console.error(err); toast("Couldn't open your saved trees"); });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
