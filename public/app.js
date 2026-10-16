/* Casper Lost Dogs - front end (vanilla JS + Leaflet) */
(() => {
  const CASPER = [42.8501, -106.3252];
  const state = { reports: [], filter: 'active', query: '', selectedId: null, pickMarker: null, photoData: null };
  const markers = new Map();      // report id -> marker
  const trailLayer = L.layerGroup();
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---------- owner keys (saved in this browser) ----------
  const KEY_STORE = 'lostdogs.ownerKeys';
  const ownerKeys = () => JSON.parse(localStorage.getItem(KEY_STORE) || '{}');
  const saveOwnerKey = (id, token) => localStorage.setItem(KEY_STORE, JSON.stringify({ ...ownerKeys(), [id]: token }));

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function timeAgo(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
    if (s < 60) return 'just now';
    const m = s / 60; if (m < 60) return `${Math.floor(m)} min ago`;
    const h = m / 60; if (h < 24) return `${Math.floor(h)} hr${h >= 2 ? 's' : ''} ago`;
    const d = h / 24; if (d < 30) return `${Math.floor(d)} day${d >= 2 ? 's' : ''} ago`;
    return new Date(iso).toLocaleDateString();
  }
  const fmtDate = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const kind = (r) => (r.reunited ? 'reunited' : r.status);
  const title = (r) => r.name || (r.status === 'spotted' ? `Unknown ${r.breed || 'dog'}` : 'Unnamed dog');
  const label = { lost: 'Lost', spotted: 'Spotted', reunited: 'Reunited' };
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200);
  }
  let backend = null; // chosen in boot(): Supabase, the Node server, or demo (see data.js)
  const localInput = (d) => { const z = new Date(d - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); };

  // ---------- main map ----------
  const map = L.map('map', { zoomControl: true }).setView(CASPER, 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  trailLayer.addTo(map);

  const icon = (r, selected) => L.divIcon({
    className: '', iconSize: [34, 34], iconAnchor: [17, 34], popupAnchor: [0, -32],
    html: `<div class="pin ${kind(r)} ${selected ? 'selected' : ''}"><span>${r.reunited ? '🏠' : r.status === 'lost' ? '🐕' : '👀'}</span></div>`,
  });
  const sightingIcon = L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9], html: '<div class="pin-sighting"></div>' });

  function popupHtml(r) {
    const k = kind(r);
    const canReunite = !r.reunited && (!r.ownerProtected || ownerKeys()[r.id]);
    const contact = [
      r.contactPhone && `📞 <a href="tel:${esc(r.contactPhone.replace(/[^\d+]/g, ''))}">${esc(r.contactPhone)}</a>`,
      r.contactEmail && `✉️ <a href="mailto:${esc(r.contactEmail)}">${esc(r.contactEmail)}</a>`,
    ].filter(Boolean).join('<br>');
    const linked = r.linkedTo && state.reports.find((x) => x.id === r.linkedTo);
    const sightings = (r.sightings || []).slice().sort((a, b) => b.seenAt.localeCompare(a.seenAt));
    return `<div class="card">
      ${r.photo ? `<img class="photo" src="${esc(r.photo)}" alt="Photo of ${esc(title(r))}">` : ''}
      <div class="c-body">
        <span class="badge ${k}">${label[k]}</span> ${r.sample ? '<span class="badge sample">Sample</span>' : ''}
        <h3>${esc(title(r))}</h3>
        <p><b>${esc(r.breed || 'Unknown breed')}</b>${r.color ? ` · ${esc(r.color)}` : ''}</p>
        ${r.description ? `<p>${esc(r.description)}</p>` : ''}
        <p class="muted">🕒 Last seen ${fmtDate(r.seenAt)} (${timeAgo(r.seenAt)})${r.locationLabel ? `<br>📍 ${esc(r.locationLabel)}` : ''}</p>
        <p class="muted">Reported ${timeAgo(r.createdAt)}${r.reunited ? ` · 🎉 Reunited ${timeAgo(r.reunitedAt)}` : ''}</p>
        ${linked ? `<p>🔗 Possibly <a href="#" data-goto="${linked.id}">${esc(title(linked))}</a> (lost)</p>` : ''}
        <div class="contact"><b>${esc(r.contactName)}</b><br>${contact || '<span class="muted">No contact listed</span>'}</div>
        ${sightings.length ? `<div class="sightings"><b>👀 ${sightings.length} sighting${sightings.length > 1 ? 's' : ''}</b><ul>${sightings.slice(0, 4).map((s) =>
          `<li>${timeAgo(s.seenAt)}${s.note ? ` – ${esc(s.note)}` : ''}${s.contactName ? ` <span class="muted">(${esc(s.contactName)}${s.contact ? `, ${esc(s.contact)}` : ''})</span>` : ''}</li>`).join('')}</ul></div>` : ''}
        <div class="actions">
          ${r.status === 'lost' && !r.reunited ? `<button class="btn btn-sight small" data-sight="${r.id}">👀 I saw this dog</button>` : ''}
          ${!r.reunited ? `<button class="btn btn-reunited small" data-reunite="${r.id}" ${canReunite ? '' : 'data-needkey="1"'}>🏠 Mark reunited</button>` : ''}
        </div>
      </div></div>`;
  }

  function drawMarkers() {
    const visibleIds = new Set(filtered().map((r) => r.id));
    for (const [id, m] of markers) if (!visibleIds.has(id)) { map.removeLayer(m); markers.delete(id); }
    for (const r of state.reports) {
      if (!visibleIds.has(r.id)) continue;
      let m = markers.get(r.id);
      if (!m) {
        m = L.marker([r.lat, r.lng], { riseOnHover: true }).addTo(map);
        m.bindPopup('', { maxWidth: 290, autoPanPadding: [20, 60] });
        m.on('click', () => select(r.id, false));
        markers.set(r.id, m);
      }
      m.setLatLng([r.lat, r.lng]);
      m.setIcon(icon(r, r.id === state.selectedId));
      m.setZIndexOffset(r.reunited ? -100 : r.status === 'lost' ? 100 : 0);
      m.getPopup().setContent(popupHtml(r));
    }
    drawTrails(visibleIds);
  }

  function drawTrails(visibleIds) {
    trailLayer.clearLayers();
    for (const r of state.reports) {
      if (r.status !== 'lost' || !visibleIds.has(r.id) || !r.sightings?.length) continue;
      const pts = [{ lat: r.lat, lng: r.lng, seenAt: r.seenAt }, ...r.sightings].sort((a, b) => a.seenAt.localeCompare(b.seenAt));
      const selected = r.id === state.selectedId;
      L.polyline(pts.map((p) => [p.lat, p.lng]), {
        color: r.reunited ? '#2E9D5B' : '#F2A33A', weight: selected ? 5 : 3, dashArray: '6 8', opacity: selected ? 1 : 0.75,
      }).addTo(trailLayer);
      r.sightings.forEach((s) => {
        L.marker([s.lat, s.lng], { icon: sightingIcon }).addTo(trailLayer).bindPopup(
          `<div class="card"><div class="c-body">${s.photo ? `<img class="photo" style="border-radius:10px" src="${esc(s.photo)}" alt="Sighting photo">` : ''}
            <span class="badge" style="background:var(--sighting);color:#3a2400">Sighting</span>
            <h3>Possible ${esc(title(r))}</h3><p class="muted">🕒 ${fmtDate(s.seenAt)} (${timeAgo(s.seenAt)})</p>
            ${s.note ? `<p>${esc(s.note)}</p>` : ''}${s.contactName || s.contact ? `<div class="contact">${esc(s.contactName || '')} ${esc(s.contact || '')}</div>` : ''}
            <div class="actions"><button class="btn btn-ghost small" data-goto="${r.id}">View ${esc(title(r))}'s report</button></div></div></div>`,
          { maxWidth: 290 });
      });
    }
  }

  // ---------- list ----------
  function filtered() {
    const q = state.query.toLowerCase().trim();
    return state.reports.filter((r) => {
      const f = state.filter;
      if (f === 'active' && r.reunited) return false;
      if (f === 'lost' && (r.status !== 'lost' || r.reunited)) return false;
      if (f === 'spotted' && (r.status !== 'spotted' || r.reunited)) return false;
      if (f === 'reunited' && !r.reunited) return false;
      if (!q) return true;
      return [r.name, r.breed, r.color, r.description, r.locationLabel].join(' ').toLowerCase().includes(q);
    });
  }

  function renderList() {
    const items = filtered();
    $('#list').innerHTML = items.length ? items.map((r) => {
      const k = kind(r);
      return `<li class="item ${r.id === state.selectedId ? 'selected' : ''}" data-id="${r.id}" tabindex="0">
        <img src="${esc(r.photo || 'favicon.svg')}" alt="" loading="lazy">
        <div class="body">
          <span class="badge ${k}">${label[k]}</span>${r.sample ? ' <span class="badge sample">Sample</span>' : ''}
          <h3>${esc(title(r))}</h3>
          <p>${esc([r.breed, r.color].filter(Boolean).join(' · ') || 'No description')}</p>
          <p class="meta">🕒 ${timeAgo(r.seenAt)}${r.locationLabel ? ` · 📍 ${esc(r.locationLabel)}` : ''}${r.sightings?.length ? ` · 👀 ${r.sightings.length}` : ''}</p>
        </div></li>`;
    }).join('') : '<li class="empty">No reports match. Try another filter or search.</li>';

    const c = { lost: 0, spotted: 0, reunited: 0 };
    state.reports.forEach((r) => c[kind(r)]++);
    $('#stats').innerHTML = `<div class="stat lost"><b>${c.lost}</b><span>Lost</span></div>
      <div class="stat spotted"><b>${c.spotted}</b><span>Spotted</span></div>
      <div class="stat reunited"><b>${c.reunited}</b><span>Reunited</span></div>`;
    $('#tab-count').textContent = items.length;
  }

  function render() { renderList(); drawMarkers(); }

  function select(id, fly = true) {
    state.selectedId = id;
    const r = state.reports.find((x) => x.id === id);
    if (!r) return;
    if (!markers.has(id)) { state.filter = 'all'; $$('.chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === 'all')); }
    render();
    setView('map');
    const m = markers.get(id);
    if (fly) {
      map.flyTo([r.lat, r.lng], Math.max(map.getZoom(), 15), { duration: 0.8 });
      map.once('moveend', () => m.openPopup());
    } else m.openPopup();
    const li = $(`.item[data-id="${id}"]`); li?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  const CACHE_KEY = 'lostdogs.lastReports';
  async function load() {
    try {
      state.reports = await backend.list();
      if (backend.mode !== 'demo') try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.reports)); } catch {}
      $('#offline-banner').hidden = true;
    } catch (e) {
      // Offline or backend down: show the last list we saw so the map is still useful
      const cached = backend.mode !== 'demo' && JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!cached) throw e;
      state.reports = cached; $('#offline-banner').hidden = false;
    }
    render();
    if (!load.fitted && state.reports.length) {
      load.fitted = true;
      const pts = state.reports.filter((r) => !r.reunited).map((r) => [r.lat, r.lng]);
      if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
    }
  }

  // ---------- mobile tabs ----------
  function setView(v) {
    if (!window.matchMedia('(max-width: 760px)').matches && v === 'list') return;
    $('.layout').dataset.view = v;
    $$('.tab[data-view]').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
    if (v === 'map') setTimeout(() => map.invalidateSize(), 50);
  }

  // ---------- report / sighting form ----------
  const form = $('#report-form');
  let pickMap;
  function ensurePickMap() {
    if (pickMap) return;
    pickMap = L.map('pick-map').setView(map.getCenter(), 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(pickMap);
    pickMap.on('click', (e) => setPick(e.latlng.lat, e.latlng.lng));
  }
  function setPick(lat, lng, zoom) {
    form.lat.value = lat.toFixed(6); form.lng.value = lng.toFixed(6);
    const ic = L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 26], html: '<div class="pin-pick"></div>' });
    if (state.pickMarker) state.pickMarker.setLatLng([lat, lng]);
    else state.pickMarker = L.marker([lat, lng], { icon: ic, draggable: true }).addTo(pickMap)
      .on('dragend', (e) => { const p = e.target.getLatLng(); form.lat.value = p.lat.toFixed(6); form.lng.value = p.lng.toFixed(6); });
    if (zoom) pickMap.setView([lat, lng], zoom);
  }

  function openModal(mode, opts = {}) {
    $('#modal').hidden = false;
    $('#done-step').hidden = true;
    $('#form-error').textContent = '';
    if (mode === 'choose') {
      $('#modal-title').textContent = 'What happened?';
      $('#choose-step').hidden = false; form.hidden = true; return;
    }
    $('#choose-step').hidden = true; form.hidden = false;
    form.reset(); state.photoData = null; $('#photo-preview').hidden = true;
    form.seenAt.value = localInput(new Date());
    form.mode.value = mode;
    form.targetId.value = opts.targetId || '';
    if (mode === 'sighting') {
      const r = state.reports.find((x) => x.id === opts.targetId);
      $('#sighting-for').innerHTML = `👀 Adding a sighting for <b>${esc(title(r))}</b> (${esc(r.breed || 'dog')}). Mark where and when you saw them.`;
    } else form.status.value = mode;
    syncFormMode();
    ensurePickMap();
    if (state.pickMarker) { pickMap.removeLayer(state.pickMarker); state.pickMarker = null; }
    setTimeout(() => { pickMap.invalidateSize(); pickMap.setView(map.getCenter(), Math.min(map.getZoom(), 14)); }, 60);
  }
  function closeModal() { $('#modal').hidden = true; }

  function syncFormMode() {
    const mode = form.mode.value === 'sighting' ? 'sighting' : form.status.value;
    const show = (sel, on) => $$(sel, form).forEach((el) => (el.hidden = !on));
    $('#status-seg').hidden = mode === 'sighting';
    $('#sighting-for').hidden = mode !== 'sighting';
    show('.f-name, .f-breed, .f-color, .f-phone, .f-email', mode !== 'sighting');
    show('.f-contact', mode === 'sighting');
    show('.opt-spotted', mode === 'spotted');
    show('.f-link', mode === 'spotted');
    $('#modal-title').textContent = { lost: 'Report a lost dog', spotted: 'Report a dog you saw or found', sighting: 'I saw this dog' }[mode];
    $('#submit-btn').textContent = mode === 'sighting' ? 'Add sighting' : 'Post report';
    form.description.placeholder = mode === 'sighting' ? 'What was the dog doing? Which way was it heading?' : 'Temperament, collar, tags, which way it was heading…';
    if (mode === 'spotted') {
      const opts = state.reports.filter((r) => r.status === 'lost' && !r.reunited)
        .map((r) => `<option value="${r.id}">${esc(title(r))} – ${esc(r.breed)}${r.color ? `, ${esc(r.color)}` : ''}</option>`).join('');
      form.linkedTo.innerHTML = `<option value="">Not sure / none of these</option>${opts}`;
    }
  }

  // Resize photos in the browser so uploads stay small on mobile data
  function readPhoto(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const max = 1200, s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = URL.createObjectURL(file);
    });
  }

  form.addEventListener('change', async (e) => {
    if (e.target.name === 'status') syncFormMode();
    if (e.target.name === 'photo') {
      const f = e.target.files[0];
      if (!f) { state.photoData = null; $('#photo-preview').hidden = true; return; }
      try {
        state.photoData = await readPhoto(f);
        $('#photo-preview img').src = state.photoData; $('#photo-preview').hidden = false;
      } catch (err) { $('#form-error').textContent = err.message; }
    }
  });

  $('#use-location').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Location is not available in this browser.');
    const b = $('#use-location'); b.textContent = '📍 Locating…';
    navigator.geolocation.getCurrentPosition(
      (p) => { setPick(p.coords.latitude, p.coords.longitude, 16); b.textContent = '📍 Use my location'; },
      () => { toast('Could not get your location. Tap the map instead.'); b.textContent = '📍 Use my location'; },
      { enableHighAccuracy: true, timeout: 10000 });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#form-error'); err.textContent = '';
    const v = Object.fromEntries(new FormData(form));
    const mode = v.mode === 'sighting' ? 'sighting' : v.status;
    if (!v.lat) return (err.textContent = 'Tap the map to mark where the dog was seen.');
    if (!v.contactName.trim()) return (err.textContent = 'Please add your name.');
    if (mode === 'lost' && !v.name.trim()) return (err.textContent = "Please add your dog's name.");
    if (mode !== 'sighting' && !v.contactPhone.trim() && !v.contactEmail.trim()) return (err.textContent = 'Add a phone number or email so people can reach you.');
    const btn = $('#submit-btn'); btn.disabled = true;
    try {
      const seenAt = new Date(v.seenAt || Date.now()).toISOString();
      if (mode === 'sighting') {
        const updated = await backend.addSighting(v.targetId, {
          lat: v.lat, lng: v.lng, seenAt, note: v.description, contactName: v.contactName, contact: v.contact, photo: state.photoData });
        upsert(updated); closeModal(); select(updated.id); toast('Thanks! Sighting added to the map.');
      } else {
        const { report, ownerToken } = await backend.create({
          status: mode, name: v.name, breed: v.breed, color: v.color, description: v.description, photo: state.photoData, seenAt,
          lat: v.lat, lng: v.lng, locationLabel: v.locationLabel, contactName: v.contactName, contactPhone: v.contactPhone,
          contactEmail: v.contactEmail, linkedTo: mode === 'spotted' ? v.linkedTo : '' });
        saveOwnerKey(report.id, ownerToken);
        await load();
        showDone(report, ownerToken);
        select(report.id);
      }
    } catch (ex) { err.textContent = ex.message; }
    finally { btn.disabled = false; }
  });

  function showDone(report, token) {
    form.hidden = true;
    const d = $('#done-step'); d.hidden = false;
    $('#modal-title').textContent = 'Report posted 🎉';
    d.innerHTML = `<div class="done"><p>Your report for <b>${esc(title(report))}</b> is now on the community map.</p>
      ${backend.mode === 'demo' ? '<p class="demo-note">⚠️ Demo mode: this report is saved only on this device. Neighbors won\'t see it until the app is connected to a shared database.</p>' : ''}
      <p>This browser remembers that you own it, so you can mark it <b>Reunited</b> later. Save this owner key in case you switch devices:</p>
      <div class="key">${esc(token)}</div>
      <button class="btn btn-primary wide" data-close>View on map</button></div>`;
  }

  function upsert(r) {
    const i = state.reports.findIndex((x) => x.id === r.id);
    if (i >= 0) state.reports[i] = r; else state.reports.unshift(r);
    render();
  }

  async function reunite(id, needKey) {
    const r = state.reports.find((x) => x.id === id);
    let token = ownerKeys()[id];
    if (needKey && !token) {
      token = prompt(`Only the person who reported ${title(r)} can mark them reunited.\nPaste your owner key:`);
      if (!token) return;
    } else if (!confirm(`Mark ${title(r)} as reunited / home safe?`)) return;
    try {
      const updated = await backend.reunite(id, token);
      if (token) saveOwnerKey(id, token);
      upsert(updated); markers.get(id)?.openPopup(); toast(`🎉 ${title(r)} is home!`);
    } catch (ex) { toast(ex.message); }
  }

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open-report],[data-choose],[data-close],[data-sight],[data-reunite],[data-goto],.item,.chip,.tab[data-view]');
    if (!t) { if (e.target === $('#modal')) closeModal(); return; }
    if (t.dataset.openReport) openModal(t.dataset.openReport);
    else if (t.dataset.choose) openModal(t.dataset.choose);
    else if (t.hasAttribute('data-close')) closeModal();
    else if (t.dataset.sight) { map.closePopup(); openModal('sighting', { targetId: t.dataset.sight }); }
    else if (t.dataset.reunite) reunite(t.dataset.reunite, !!t.dataset.needkey);
    else if (t.dataset.goto) { e.preventDefault(); map.closePopup(); select(t.dataset.goto); }
    else if (t.classList.contains('item')) select(t.dataset.id);
    else if (t.classList.contains('chip')) {
      state.filter = t.dataset.filter; $$('.chip').forEach((c) => c.classList.toggle('active', c === t)); render();
    } else if (t.dataset.view) setView(t.dataset.view);
  });
  $('#list').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.id) select(e.target.dataset.id); });
  $('#search').addEventListener('input', (e) => { state.query = e.target.value; render(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // ---------- install as an app ----------
  let installEvt = null;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#install-btn').hidden = false; });
  window.addEventListener('appinstalled', () => { $('#install-btn').hidden = true; toast('Installed! Find Casper Lost Dogs on your home screen.'); });
  if (isIOS && !standalone() && !window.Capacitor) $('#install-btn').hidden = false;
  $('#install-btn').addEventListener('click', async () => {
    if (installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; $('#install-btn').hidden = true; }
    else $('#ios-install').hidden = false;
  });
  $('#ios-install').addEventListener('click', (e) => { if (e.target.closest('[data-dismiss]') || e.target === $('#ios-install')) $('#ios-install').hidden = true; });
  // Offline support. Skipped inside the Android app (files are already bundled there).
  if ('serviceWorker' in navigator && !window.Capacitor && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e)));
  }

  // ---------- start ----------
  async function boot() {
    backend = await window.LostDogsData.init();
    document.documentElement.dataset.backend = backend.mode;
    if (backend.mode === 'demo') {
      $('#demo-banner').hidden = false;
      $('#demo-reset').addEventListener('click', () => {
        if (!confirm('Erase the reports you added on this device and restore the sample dogs?')) return;
        backend.reset(); localStorage.removeItem(KEY_STORE); load().then(() => toast('Demo data reset.'));
      });
    }
    await load();
    const want = new URLSearchParams(location.search).get('report'); // home-screen shortcuts
    if (want === 'lost' || want === 'spotted') openModal(want);
    setInterval(() => load().catch(() => {}), 60000); // pick up neighbors' new reports
  }
  boot().catch((e) => toast(e.message));
  window.__lostDogs = { state, map, select, load, get backend() { return backend; } };
})();
