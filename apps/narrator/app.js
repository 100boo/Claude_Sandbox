/* Narrator — main UI + playback. Depends on: JSZip, Parsers (parsers.js), DB (db.js). */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const synth = window.speechSynthesis;

  // ------------------------------------------------------------- settings

  const SETTINGS_KEY = 'narrator.settings.v1';
  const DEFAULTS = {
    voiceURI: '',
    rate: 1,
    pitch: 1,
    readHeadings: true,
    keepAlive: true,
    wakeLock: false,
    autoScroll: true,
    removeNotices: true,
  };
  const settings = loadSettings();

  function loadSettings() {
    try {
      return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* private mode */ }
  }

  // ---------------------------------------------------------------- state

  const state = {
    meta: null,       // current book's meta record
    chapters: null,   // current book's chapters
    ch: 0,            // chapter index
    p: 0,             // paragraph index within chapter
    chunk: 0,         // speech chunk index within paragraph
    titleDone: false, // chapter title already announced
    playing: false,
    token: 0,         // bumps on every (re)start/stop; stale loops exit when it changes
    sleepUntil: 0,
    sleepAtChapterEnd: false,
  };
  const chunkCache = new Map();

  // ---------------------------------------------------------------- utils

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let toastTimer = 0;
  function toast(msg, ms) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms || 2800);
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // iPhone/iPad (iPadOS reports itself as a Mac with a touch screen).
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /** Recent playback events, shown in Settings → Playback log, for diagnosing device-specific speech problems. */
  const playLog = [];
  function log(msg) {
    const t = new Date();
    const stamp = `${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}.${String(t.getMilliseconds()).padStart(3, '0')}`;
    playLog.push(`${stamp} ${msg}`);
    if (playLog.length > 300) playLog.shift();
  }
  const norm = (s) => String(s || '').trim().toLowerCase();

  function bookProgress(meta) {
    const total = meta.totalParas || 1;
    let done = 0;
    for (let i = 0; i < meta.pos.ch; i++) done += meta.chapterLens[i] || 0;
    done += meta.pos.p;
    return Math.min(1, done / total);
  }

  // -------------------------------------------------------------- screens

  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  }
  function openSheet(id) { $(id).hidden = false; }
  function closeSheets() { document.querySelectorAll('.sheet').forEach((s) => { s.hidden = true; }); }

  document.querySelectorAll('.sheet').forEach((sheet) => {
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet || e.target.closest('[data-close]')) sheet.hidden = true;
    });
  });

  // -------------------------------------------------------------- library

  async function renderLibrary() {
    const books = await DB.listBooks();
    books.sort((a, b) => (b.openedAt || b.addedAt) - (a.openedAt || a.addedAt));
    const list = $('bookList');
    list.textContent = '';
    $('emptyMsg').hidden = books.length > 0;
    for (const m of books) {
      const li = document.createElement('li');
      li.className = 'book';
      li.dataset.id = m.id;

      const cover = document.createElement('div');
      cover.className = 'cover';
      if (m.cover) cover.style.backgroundImage = `url("${m.cover}")`;
      else cover.textContent = (m.title || '?').trim().charAt(0).toUpperCase();

      const meta = document.createElement('div');
      meta.className = 'meta';
      const b = document.createElement('b');
      b.textContent = m.title;
      const small = document.createElement('small');
      const pct = Math.round(bookProgress(m) * 100);
      small.textContent = `${m.author ? m.author + ' · ' : ''}Ch ${m.pos.ch + 1} of ${m.chapterLens.length} · ${pct}%`;
      const bar = document.createElement('div');
      bar.className = 'bar-mini';
      const fill = document.createElement('i');
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      meta.append(b, small, bar);

      const del = document.createElement('button');
      del.className = 'del';
      del.setAttribute('aria-label', `Delete ${m.title}`);
      del.textContent = '🗑';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete “${m.title}” from this device?`)) return;
        await DB.deleteBook(m.id);
        renderLibrary();
      });

      li.append(cover, meta, del);
      li.addEventListener('click', () => openBook(m.id));
      list.appendChild(li);
    }
  }

  // --------------------------------------------------------------- import

  function makeMeta(book, existing) {
    const chapterLens = book.chapters.map((c) => c.paras.length);
    const meta = {
      id: existing ? existing.id : uid(),
      title: book.title,
      author: book.author || '',
      format: book.format,
      cover: book.cover || (existing && existing.cover) || null,
      chapterTitles: book.chapters.map((c) => c.title),
      chapterLens,
      totalParas: chapterLens.reduce((a, b) => a + b, 0),
      pos: existing ? existing.pos : { ch: 0, p: 0 },
      addedAt: existing ? existing.addedAt : Date.now(),
      openedAt: existing ? existing.openedAt : 0,
    };
    // Clamp a carried-over position to the new content.
    if (meta.pos.ch >= chapterLens.length) meta.pos = { ch: 0, p: 0 };
    else if (meta.pos.p >= chapterLens[meta.pos.ch]) meta.pos = { ch: meta.pos.ch, p: 0 };
    return meta;
  }

  /** Add a parsed book. Re-importing the same title+author (e.g. a serial with new chapters) updates it in place and keeps your place. */
  async function saveParsedBook(book) {
    if (!book.chapters.length) throw new Error('No readable text found');
    const all = await DB.listBooks();
    const existing = all.find((m) => norm(m.title) === norm(book.title) && norm(m.author) === norm(book.author));
    const meta = makeMeta(book, existing);
    await DB.addBook(meta, book.chapters);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if (existing) {
      const added = meta.chapterLens.length - existing.chapterLens.length;
      return `Updated “${meta.title}”${added > 0 ? ` (+${added} new chapter${added > 1 ? 's' : ''})` : ''}`;
    }
    return `Added “${meta.title}” (${meta.chapterLens.length} chapter${meta.chapterLens.length > 1 ? 's' : ''})`;
  }

  async function importFiles(files) {
    let last = '';
    for (const file of files) {
      toast(`Importing ${file.name}…`, 60000);
      try {
        const book = await Parsers.parseFile(file, { removeNotices: settings.removeNotices });
        last = await saveParsedBook(book);
      } catch (err) {
        console.error(err);
        last = `Couldn't import ${file.name}: ${err.message || err}`;
      }
    }
    await renderLibrary();
    if (last) toast(last, 4000);
  }

  $('fileInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) importFiles(files);
  });

  $('pasteBtn').addEventListener('click', () => {
    $('pasteTitle').value = '';
    $('pasteText').value = '';
    openSheet('pasteSheet');
  });
  $('pasteSave').addEventListener('click', async () => {
    const text = $('pasteText').value;
    if (!text.trim()) return toast('Paste some text first');
    const title = $('pasteTitle').value.trim() || text.trim().split('\n')[0].slice(0, 60);
    try {
      const msg = await saveParsedBook(Parsers.parseText(text, title, { removeNotices: settings.removeNotices }));
      closeSheets();
      await renderLibrary();
      toast(msg);
    } catch (err) {
      toast(err.message || String(err));
    }
  });

  /** Files shared to the app (Android share sheet) are parked in the inbox by the service worker. */
  async function drainInbox() {
    let items = [];
    try { items = await DB.drainInbox(); } catch (e) { return; }
    if (!items.length) return;
    await importFiles(items.map((it) => ({ name: it.name, arrayBuffer: async () => it.data })));
  }

  // --------------------------------------------------------------- reader

  async function openBook(id) {
    const [meta, content] = await Promise.all([DB.getMeta(id), DB.getContent(id)]);
    if (!meta || !content) return toast('Book not found');
    stop('opened a book');
    chunkCache.clear();
    searchCache = [];
    state.meta = meta;
    state.chapters = content.chapters;
    state.ch = Math.min(meta.pos.ch, content.chapters.length - 1);
    state.p = meta.pos.p;
    state.chunk = 0;
    state.titleDone = state.p > 0;
    meta.openedAt = Date.now();
    DB.putMeta(meta);
    $('pTitle').textContent = meta.title;
    show('player');
    renderChapter();
    highlight(true);
    updateMediaMetadata();
  }

  function renderChapter() {
    const ch = state.chapters[state.ch];
    const reader = $('reader');
    reader.textContent = '';
    const head = document.createElement('p');
    head.className = 'h';
    head.textContent = ch.title;
    head.dataset.i = '-1';
    reader.appendChild(head);
    const frag = document.createDocumentFragment();
    ch.paras.forEach((t, i) => {
      const p = document.createElement('p');
      p.textContent = t;
      p.dataset.i = String(i);
      frag.appendChild(p);
    });
    reader.appendChild(frag);
    reader.scrollTop = 0;
    $('chapterBtn').textContent = `${state.ch + 1}/${state.chapters.length} · ${ch.title}`;
    $('seek').max = String(Math.max(0, ch.paras.length - 1));
  }

  let lastUserScroll = 0;
  ['touchstart', 'wheel'].forEach((ev) => $('reader').addEventListener(ev, () => { lastUserScroll = Date.now(); }, { passive: true }));

  function highlight(force) {
    const reader = $('reader');
    const prev = reader.querySelector('p.cur');
    if (prev) prev.classList.remove('cur');
    const el = reader.querySelector(`p[data-i="${state.p}"]`);
    if (el) {
      el.classList.add('cur');
      if (force || (settings.autoScroll && Date.now() - lastUserScroll > 4000)) {
        el.scrollIntoView({ block: 'center', behavior: force ? 'auto' : 'smooth' });
      }
    }
    const ch = state.chapters[state.ch];
    $('seek').value = String(state.p);
    const pct = Math.round(bookProgress({ ...state.meta, pos: { ch: state.ch, p: state.p } }) * 100);
    $('progText').textContent = `¶ ${state.p + 1}/${ch.paras.length} · ${pct}% of book`;
    savePos();
  }

  $('reader').addEventListener('click', (e) => {
    const p = e.target.closest('p[data-i]');
    if (!p) return;
    const i = Number(p.dataset.i);
    goto(state.ch, Math.max(0, i), { titleDone: i >= 0 });
    if (!state.playing) play();
  });

  let saveTimer = 0;
  /** Debounced while reading; pass now=true to write immediately (returns a promise). */
  function savePos(now) {
    if (!state.meta) return Promise.resolve();
    state.meta.pos = { ch: state.ch, p: state.p };
    clearTimeout(saveTimer);
    if (now) return DB.putMeta(state.meta).catch((e) => console.warn('save failed', e));
    saveTimer = setTimeout(() => DB.putMeta(state.meta), 1500);
    return Promise.resolve();
  }

  // --------------------------------------------------------------- speech

  let voices = [];
  function loadVoices() {
    voices = synth ? synth.getVoices() : [];
    const sel = $('voiceSel');
    sel.textContent = '';
    const lang = (navigator.language || 'en').slice(0, 2);
    const sorted = voices.slice().sort((a, b) => {
      const al = a.lang.startsWith(lang) ? 0 : 1;
      const bl = b.lang.startsWith(lang) ? 0 : 1;
      return al - bl || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name);
    });
    const def = document.createElement('option');
    def.value = '';
    def.textContent = 'System default';
    sel.appendChild(def);
    for (const v of sorted) {
      const o = document.createElement('option');
      o.value = v.voiceURI;
      o.textContent = `${v.name} (${v.lang})${v.localService ? '' : ' · online'}`;
      sel.appendChild(o);
    }
    sel.value = settings.voiceURI && voices.some((v) => v.voiceURI === settings.voiceURI) ? settings.voiceURI : '';
  }
  if (synth) {
    loadVoices();
    synth.addEventListener ? synth.addEventListener('voiceschanged', loadVoices) : (synth.onvoiceschanged = loadVoices);
  }
  const currentVoice = () => voices.find((v) => v.voiceURI === settings.voiceURI) || null;

  let liveUtterance = null; // keep a reference: some browsers GC utterances and never fire onend

  /** Speak one chunk. Resolves 'ok' | 'stopped' | 'error:<code>' | 'silent'. */
  function speakChunk(text, token) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const v = currentVoice();
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = settings.rate;
      u.pitch = settings.pitch;
      let done = false;
      let started = false;
      const t0 = Date.now();
      const finish = (r) => {
        if (done) return;
        done = true;
        clearInterval(watch);
        resolve(r);
      };
      const ms = () => `${Date.now() - t0}ms`;
      u.onstart = () => { started = true; log(`start "${text.slice(0, 40)}"`); };
      u.onend = () => { log(`end ${ms()}${started ? '' : ' (never started)'}`); finish(started ? 'ok' : 'silent'); };
      u.onerror = (e) => {
        const code = e.error || 'unknown';
        log(`error ${code} after ${ms()}`);
        if (token !== state.token) return finish('stopped'); // we cancelled it ourselves
        // Cut off by something else (the OS, another sound): the caller retries the chunk.
        finish(code === 'interrupted' || code === 'canceled' ? 'interrupted' : 'error:' + code);
      };
      // Watchdog: some engines occasionally never fire onend.
      const watch = setInterval(() => {
        if (token !== state.token) return finish('stopped');
        if (Date.now() - t0 > 2500 && !synth.speaking && !synth.pending) {
          log(`watchdog: engine idle after ${ms()}${started ? '' : ', never started'}`);
          finish(started ? 'ok' : 'silent');
        }
      }, 500);
      liveUtterance = u;
      synth.speak(u);
    });
  }

  function chunksFor(ch, p) {
    const key = ch + ':' + p;
    let c = chunkCache.get(key);
    if (!c) {
      c = Parsers.splitForSpeech(state.chapters[ch].paras[p] || '');
      chunkCache.set(key, c);
    }
    return c;
  }

  async function playLoop() {
    const token = ++state.token;
    synth.cancel();
    await sleep(80); // Chrome drops a speak() issued immediately after cancel()
    let silentRun = 0;
    let interruptRun = 0;

    const say = async (text) => {
      let r = await speakChunk(text, token);
      // Retry a chunk the OS cut off, rather than going quiet while still "playing".
      while (r === 'interrupted' && token === state.token && interruptRun < 5) {
        interruptRun++;
        log(`retrying interrupted chunk (${interruptRun})`);
        await sleep(250 * interruptRun);
        if (token !== state.token) return false;
        r = await speakChunk(text, token);
      }
      if (token !== state.token || r === 'stopped') return false;
      if (r === 'interrupted') {
        stop('kept being interrupted');
        toast('Speech keeps getting interrupted. Open Settings → Playback log and send it to Claude.', 6000);
        return false;
      }
      interruptRun = 0;
      if (r.startsWith('error:')) {
        const code = r.slice(6);
        stop('speech error ' + code);
        toast(code === 'not-allowed' ? 'Tap play to start speech' : `Speech error: ${code}`, 4000);
        return false;
      }
      silentRun = r === 'silent' ? silentRun + 1 : 0;
      if (silentRun >= 4) {
        stop('engine silent');
        toast('The speech engine is not responding. Try another voice in Settings.', 5000);
        return false;
      }
      return true;
    };

    while (state.playing && token === state.token) {
      const chapter = state.chapters[state.ch];

      if (settings.readHeadings && state.p === 0 && state.chunk === 0 && !state.titleDone) {
        if (!(await say(chapter.title))) return;
        state.titleDone = true;
        await sleep(350);
        if (token !== state.token) return;
      }

      const chunks = chunksFor(state.ch, state.p);
      while (state.chunk < chunks.length) {
        if (!(await say(chunks[state.chunk]))) return;
        state.chunk++;
        if (checkSleepTimer()) return;
      }

      // Next paragraph / chapter.
      state.chunk = 0;
      if (state.p + 1 < chapter.paras.length) {
        state.p++;
        highlight();
        continue;
      }
      if (state.sleepAtChapterEnd) {
        clearSleep();
        goto(Math.min(state.ch + 1, state.chapters.length - 1), 0);
        stop('sleep timer: end of chapter');
        toast('Sleep timer: stopped at end of chapter');
        return;
      }
      if (state.ch + 1 >= state.chapters.length) {
        stop('end of book');
        toast('The end — you finished the book 🎉', 5000);
        return;
      }
      state.ch++;
      state.p = 0;
      state.titleDone = false;
      renderChapter();
      highlight(true);
      updateMediaMetadata();
      await sleep(600);
    }
  }

  // ------------------------------------------------------------ transport

  function play() {
    if (!synth) return toast('This browser has no text-to-speech support');
    if (!state.chapters) return;
    state.playing = true;
    log(`play ch${state.ch + 1} p${state.p + 1} rate ${settings.rate} voice ${settings.voiceURI || 'default'}`);
    updatePlayButton();
    startKeepAlive();
    requestWakeLock();
    playLoop();
  }

  function stop(reason) {
    const wasPlaying = state.playing;
    if (wasPlaying) log(`stop (${typeof reason === 'string' ? reason : 'pause button'})`);
    state.playing = false;
    state.token++;
    if (synth) synth.cancel();
    stopKeepAlive();
    releaseWakeLock();
    updatePlayButton();
    if (wasPlaying) savePos(true);
  }

  function toggle() { state.playing ? stop() : play(); }

  function goto(ch, p, opts) {
    const o = opts || {};
    const chChanged = ch !== state.ch;
    state.ch = Math.max(0, Math.min(ch, state.chapters.length - 1));
    const len = state.chapters[state.ch].paras.length;
    state.p = Math.max(0, Math.min(p, len - 1));
    state.chunk = 0;
    state.titleDone = o.titleDone !== undefined ? o.titleDone : state.p > 0;
    if (chChanged) { renderChapter(); updateMediaMetadata(); }
    highlight(true);
    if (state.playing) playLoop();
  }

  function nextPara() {
    if (state.p + 1 < state.chapters[state.ch].paras.length) goto(state.ch, state.p + 1);
    else if (state.ch + 1 < state.chapters.length) goto(state.ch + 1, 0, { titleDone: false });
  }
  function prevPara() {
    if (state.p > 0) goto(state.ch, state.p - 1);
    else if (state.ch > 0) goto(state.ch - 1, state.chapters[state.ch - 1].paras.length - 1);
  }
  function nextChapter() { if (state.ch + 1 < state.chapters.length) goto(state.ch + 1, 0, { titleDone: false }); }
  function prevChapter() {
    // Like a music player: first press restarts the chapter, second goes back.
    if (state.p > 2 || state.ch === 0) goto(state.ch, 0, { titleDone: false });
    else goto(state.ch - 1, 0, { titleDone: false });
  }

  function updatePlayButton() {
    const b = $('playBtn');
    b.textContent = state.playing ? '❚❚' : '▶';
    b.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused';
  }

  $('playBtn').addEventListener('click', toggle);
  $('nextP').addEventListener('click', nextPara);
  $('prevP').addEventListener('click', prevPara);
  $('nextCh').addEventListener('click', nextChapter);
  $('prevCh').addEventListener('click', prevChapter);
  $('seek').addEventListener('change', (e) => goto(state.ch, Number(e.target.value)));
  $('backBtn').addEventListener('click', async () => {
    stop('back to library');
    await savePos(true);
    show('library');
    renderLibrary();
  });

  // ------------------------------------------------ background / lock screen

  // A looping, silent WAV keeps mobile browsers treating the page as "playing
  // audio", which gives us lock-screen controls and makes it less likely the
  // OS suspends speech when the screen turns off.
  let silentUrl = null;
  function silentWavUrl() {
    if (silentUrl) return silentUrl;
    const rate = 8000, secs = 2, n = rate * secs;
    const buf = new ArrayBuffer(44 + n);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    str(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    silentUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    return silentUrl;
  }
  function startKeepAlive() {
    // On iPhone the silent loop competes with speech for the audio session and can cut the
    // voice off, and iOS suspends web speech with the screen off regardless. Android only.
    if (!settings.keepAlive || IS_IOS) return;
    const a = $('keepAliveAudio');
    if (!a.src) a.src = silentWavUrl();
    a.volume = 0.01;
    a.play().catch(() => {});
  }
  function stopKeepAlive() { $('keepAliveAudio').pause(); }

  let wakeLock = null;
  async function requestWakeLock() {
    if (!settings.wakeLock || !('wakeLock' in navigator) || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { /* not allowed right now */ }
  }
  function releaseWakeLock() { if (wakeLock) wakeLock.release().catch(() => {}); wakeLock = null; }

  document.addEventListener('visibilitychange', () => {
    log(`app ${document.visibilityState}`);
    if (document.visibilityState === 'hidden') { savePos(true); return; }
    if (state.playing) {
      requestWakeLock();
      // If the OS killed speech while we were in the background, pick it back up.
      if (!synth.speaking && !synth.pending) { log('resuming after background'); playLoop(); }
    }
  });
  window.addEventListener('pagehide', () => savePos(true));

  function updateMediaMetadata() {
    if (!('mediaSession' in navigator) || !state.meta) return;
    const art = state.meta.cover ? [{ src: state.meta.cover, sizes: '512x512' }] : [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: state.chapters[state.ch].title,
        artist: state.meta.author || state.meta.title,
        album: state.meta.title,
        artwork: art,
      });
    } catch (e) { /* MediaMetadata unsupported */ }
  }
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch (e) { /* unsupported action */ } };
    set('play', () => { log('media key: play'); play(); });
    set('pause', () => stop('media key / lock screen pause'));
    set('stop', () => stop('media key / lock screen stop'));
    set('previoustrack', prevChapter);
    set('nexttrack', nextChapter);
    set('seekbackward', prevPara);
    set('seekforward', nextPara);
  }

  // ------------------------------------------------------------ sleep timer

  let sleepTick = 0;
  function setSleep(val) {
    clearSleep();
    if (val === 'chapter') state.sleepAtChapterEnd = true;
    else if (val !== 'off') state.sleepUntil = Date.now() + Number(val) * 60000;
    if (val !== 'off') sleepTick = setInterval(renderSleep, 1000);
    renderSleep();
  }
  function clearSleep() {
    state.sleepUntil = 0;
    state.sleepAtChapterEnd = false;
    clearInterval(sleepTick);
    renderSleep();
  }
  function renderSleep() {
    let txt = '';
    if (state.sleepAtChapterEnd) txt = '☾ end of chapter';
    else if (state.sleepUntil) {
      const left = Math.max(0, state.sleepUntil - Date.now());
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      txt = `☾ ${m}:${String(s).padStart(2, '0')}`;
    }
    $('sleepText').textContent = txt;
    $('sleepBtn').classList.toggle('on', !!txt);
  }
  /** Returns true if the timer fired (playback stopped). */
  function checkSleepTimer() {
    if (state.sleepUntil && Date.now() >= state.sleepUntil) {
      clearSleep();
      stop('sleep timer');
      toast('Sleep timer: playback stopped');
      return true;
    }
    return false;
  }
  $('sleepBtn').addEventListener('click', () => openSheet('sleepSheet'));
  document.querySelectorAll('[data-sleep]').forEach((b) => b.addEventListener('click', () => {
    setSleep(b.dataset.sleep);
    closeSheets();
  }));

  // ------------------------------------------------------------- chapters

  let searchCache = [];   // folded paragraph text per chapter, reset when a book opens
  let searchTimer = 0;

  function chapterItem(i, label, sub) {
    const li = document.createElement('li');
    if (i === state.ch) li.className = 'cur';
    const name = document.createElement('span');
    name.textContent = label;
    const small = document.createElement('small');
    small.textContent = sub;
    li.append(name, small);
    li.addEventListener('click', () => { closeSheets(); goto(i, 0, { titleDone: false }); });
    return li;
  }

  function renderChapterSearch(query) {
    const q = (query || '').trim();
    const titles = state.chapters.map((c) => c.title);
    const list = $('chapterList');
    list.textContent = '';
    for (const i of Search.matchChapters(titles, q)) {
      list.appendChild(chapterItem(i, `${i + 1}. ${titles[i]}`, `${state.chapters[i].paras.length} ¶`));
    }

    const hitsEl = $('textHits');
    hitsEl.textContent = '';
    const hits = q ? Search.searchText(state.chapters, q, { cache: searchCache }) : [];
    for (const h of hits) {
      const li = document.createElement('li');
      const where = document.createElement('small');
      where.textContent = `Ch ${h.ch + 1} · ${titles[h.ch]}`;
      const text = document.createElement('span');
      const mark = document.createElement('mark');
      mark.textContent = h.match;
      text.append(h.before, mark, h.after);
      li.append(where, text);
      li.addEventListener('click', () => { closeSheets(); goto(h.ch, h.p, { titleDone: true }); });
      hitsEl.appendChild(li);
    }
    $('textHitsHead').hidden = hits.length === 0;
    $('textHitsHead').textContent = hits.length >= 50 ? 'In the text (first 50)' : 'In the text';
    $('searchEmpty').hidden = !q || list.children.length + hits.length > 0;
  }

  $('chapterSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderChapterSearch(e.target.value), 150);
  });
  $('chapterSearch').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(searchTimer);
    renderChapterSearch(e.target.value);
    e.target.blur(); // hide the iPhone keyboard so results are visible
  });

  $('chapterBtn').addEventListener('click', () => {
    $('chapterSearch').value = '';
    renderChapterSearch('');
    openSheet('chapterSheet');
    const cur = $('chapterList').querySelector('.cur');
    if (cur) cur.scrollIntoView({ block: 'center' });
  });

  // ------------------------------------------------------------- settings

  const RATE_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  function renderSettings() {
    $('rateRange').value = settings.rate;
    $('pitchRange').value = settings.pitch;
    $('rateVal').textContent = settings.rate.toFixed(2) + '×';
    $('pitchVal').textContent = settings.pitch.toFixed(2);
    $('rateBtn').textContent = (Math.round(settings.rate * 100) / 100) + '×';
    for (const k of ['readHeadings', 'keepAlive', 'wakeLock', 'autoScroll', 'removeNotices']) $(k).checked = !!settings[k];
  }
  function changed(restartSpeech) {
    saveSettings();
    renderSettings();
    if (restartSpeech && state.playing) playLoop(); // re-speak current chunk with new voice/rate
  }

  function openSettings() {
    $('logView').textContent = playLog.length ? playLog.join('\n') : 'Nothing yet. Play a book first.';
    openSheet('settingsSheet');
  }
  $('settingsBtn').addEventListener('click', openSettings);
  $('settingsBtn2').addEventListener('click', openSettings);
  $('keepAliveRow').hidden = IS_IOS; // no effect on iPhone (see startKeepAlive)
  $('copyLog').addEventListener('click', async () => {
    const text = `Narrator v${self.APP_VERSION} · ${navigator.userAgent}\n` + playLog.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Log copied. Paste it into your chat with Claude.');
    } catch (e) {
      // Clipboard blocked: select the text so it can be copied by hand.
      const r = document.createRange();
      r.selectNodeContents($('logView'));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      toast('Press and hold the selected text to copy it.');
    }
  });
  $('voiceSel').addEventListener('change', (e) => { settings.voiceURI = e.target.value; changed(true); });
  $('rateRange').addEventListener('input', (e) => { settings.rate = Number(e.target.value); renderSettings(); });
  $('rateRange').addEventListener('change', () => changed(true));
  $('pitchRange').addEventListener('input', (e) => { settings.pitch = Number(e.target.value); renderSettings(); });
  $('pitchRange').addEventListener('change', () => changed(true));
  for (const k of ['readHeadings', 'keepAlive', 'wakeLock', 'autoScroll', 'removeNotices']) {
    $(k).addEventListener('change', (e) => {
      settings[k] = e.target.checked;
      changed(false);
      if (state.playing && k === 'keepAlive') (settings.keepAlive ? startKeepAlive : stopKeepAlive)();
      if (state.playing && k === 'wakeLock') (settings.wakeLock ? requestWakeLock : releaseWakeLock)();
    });
  }
  $('rateBtn').addEventListener('click', () => {
    settings.rate = RATE_STEPS.find((r) => r > settings.rate + 0.01) || RATE_STEPS[0];
    changed(true);
  });
  $('testVoice').addEventListener('click', () => {
    if (!synth) return toast('This browser has no text-to-speech support');
    stop('test voice');
    const token = ++state.token;
    setTimeout(() => speakChunk('This is how your books will sound. The dungeon core pulsed softly in the dark.', token), 80);
  });

  // ------------------------------------------------------------------ boot

  $('appVersion').textContent = 'v' + (self.APP_VERSION || '?');
  renderSettings();
  renderLibrary().then(drainInbox);
  if (!synth) toast('Text-to-speech is not available in this browser', 6000);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'inbox') drainInbox();
    });
  }
  // Desktop Chrome/Edge: "Open with Narrator" from the file manager.
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files || !params.files.length) return;
      importFiles(await Promise.all(params.files.map((h) => h.getFile())));
    });
  }
  if (new URLSearchParams(location.search).has('shared')) history.replaceState(null, '', location.pathname);

  // Expose a tiny surface for debugging and end-to-end tests.
  window.Narrator = { state, settings, openBook, goto, play, stop };
})();
