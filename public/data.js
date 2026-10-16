/*
 * Pluggable data layer. Every backend exposes the same four calls:
 *   list()                      -> [report]
 *   create(payload)             -> { report, ownerToken }
 *   reunite(id, ownerToken)     -> report
 *   addSighting(id, payload)    -> report
 * Reports use the camelCase shape the Node API has always returned.
 */
(() => {
  const cfg = window.LOST_DOGS_CONFIG || {};

  // ---------- 1. Node server (npm start / self-hosting) ----------
  async function http(path, opts = {}) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const serverBackend = {
    mode: 'server',
    list: () => http('api/reports'),
    create: (p) => http('api/reports', { method: 'POST', body: JSON.stringify(p) }),
    reunite: (id, ownerToken) => http(`api/reports/${encodeURIComponent(id)}/reunite`, { method: 'POST', body: JSON.stringify({ ownerToken }) }),
    addSighting: (id, p) => http(`api/reports/${encodeURIComponent(id)}/sightings`, { method: 'POST', body: JSON.stringify(p) }),
  };

  // ---------- 2. Supabase (REST + Storage, no SDK needed) ----------
  function supabaseBackend() {
    const base = cfg.supabaseUrl.replace(/\/+$/, '');
    const key = cfg.supabaseAnonKey.trim();
    const bucket = cfg.photoBucket || 'dog-photos';
    const headers = (extra = {}) => {
      const h = { apikey: key, ...extra };
      if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`; // legacy JWT anon key
      return h;
    };
    async function sb(path, opts = {}) {
      const res = await fetch(`${base}${path}`, { ...opts, headers: headers({ 'Content-Type': 'application/json', ...(opts.headers || {}) }) });
      const text = await res.text();
      let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!res.ok) {
        const msg = (data && (data.message || data.error_description || data.error)) || `Request failed (${res.status})`;
        throw new Error(msg);
      }
      return data;
    }
    const rpc = (fn, args) => sb(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });

    async function uploadPhoto(dataUrl) {
      if (!dataUrl) return null;
      const m = /^data:(image\/(jpeg|png|webp|gif));base64,(.+)$/.exec(dataUrl);
      if (!m) throw new Error('Photo must be a JPEG, PNG, WebP or GIF image.');
      const bin = atob(m[3]); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
      const name = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)}.${ext}`;
      const res = await fetch(`${base}/storage/v1/object/${bucket}/${name}`, {
        method: 'POST', headers: headers({ 'Content-Type': m[1], 'x-upsert': 'false', 'cache-control': '86400' }), body: bytes,
      });
      if (!res.ok) throw new Error(`Photo upload failed (${res.status}). Check the storage bucket in supabase/schema.sql.`);
      return `${base}/storage/v1/object/public/${bucket}/${name}`;
    }

    const fromRow = (r) => ({
      id: r.id, status: r.status, reunited: r.reunited, reunitedAt: r.reunited_at, name: r.name || '', breed: r.breed || '',
      color: r.color || '', description: r.description || '', photo: r.photo, seenAt: r.seen_at, lat: r.lat, lng: r.lng,
      locationLabel: r.location_label || '', contactName: r.contact_name || '', contactPhone: r.contact_phone || '',
      contactEmail: r.contact_email || '', linkedTo: r.linked_to, sample: !!r.sample, createdAt: r.created_at, ownerProtected: true,
      sightings: (r.sightings || []).map((s) => ({
        id: s.id, lat: s.lat, lng: s.lng, seenAt: s.seen_at, note: s.note || '', contactName: s.contact_name || '',
        contact: s.contact || '', photo: s.photo, reportId: s.from_report_id, createdAt: s.created_at,
      })),
    });
    const getOne = async (id) => {
      const rows = await sb(`/rest/v1/reports?select=*,sightings!report_id(*)&id=eq.${encodeURIComponent(id)}`);
      if (!rows || !rows.length) throw new Error('Report not found.');
      return fromRow(rows[0]);
    };

    return {
      mode: 'supabase',
      async list() {
        const rows = await sb('/rest/v1/reports?select=*,sightings!report_id(*)&order=created_at.desc&limit=1000');
        return rows.map(fromRow);
      },
      async create(p) {
        const photo = await uploadPhoto(p.photo);
        const out = await rpc('create_report', {
          p_status: p.status, p_name: p.name || '', p_breed: p.breed || '', p_color: p.color || '', p_description: p.description || '',
          p_photo: photo, p_seen_at: p.seenAt, p_lat: Number(p.lat), p_lng: Number(p.lng), p_location_label: p.locationLabel || '',
          p_contact_name: p.contactName || '', p_contact_phone: p.contactPhone || '', p_contact_email: p.contactEmail || '',
          p_linked_to: p.linkedTo || null,
        });
        const row = Array.isArray(out) ? out[0] : out;
        return { report: await getOne(row.report_id), ownerToken: row.owner_token };
      },
      async reunite(id, ownerToken) {
        await rpc('reunite_report', { p_id: id, p_owner_token: ownerToken || '' });
        return getOne(id);
      },
      async addSighting(id, p) {
        const photo = await uploadPhoto(p.photo);
        await rpc('add_sighting', {
          p_report_id: id, p_lat: Number(p.lat), p_lng: Number(p.lng), p_seen_at: p.seenAt, p_note: p.note || '',
          p_contact_name: p.contactName || '', p_contact: p.contact || '', p_photo: photo,
        });
        return getOne(id);
      },
    };
  }

  // ---------- 3. Demo mode (sample data + this device's localStorage) ----------
  function demoBackend() {
    const STORE = 'lostdogs.demo.v1';
    const newId = () => Math.random().toString(16).slice(2, 14);
    const load = () => {
      try { const d = JSON.parse(localStorage.getItem(STORE)); if (d && Array.isArray(d.reports)) return d; } catch {}
      return { reports: window.buildSeed() };
    };
    const save = (d) => {
      try { localStorage.setItem(STORE, JSON.stringify(d)); }
      catch { throw new Error('This device is out of space for demo reports. Try a smaller photo.'); }
    };
    const pub = (r) => { const { ownerToken, ...rest } = r; return { ...rest, ownerProtected: !!ownerToken }; };
    const clean = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const iso = (v) => { const d = new Date(v); return isNaN(d) ? new Date().toISOString() : d.toISOString(); };
    const fail = (m) => { throw new Error(m); };
    const pause = () => new Promise((r) => setTimeout(r, 120));
    return {
      mode: 'demo',
      async list() {
        const d = load();
        return [...d.reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(pub);
      },
      async create(b) {
        await pause();
        const d = load();
        const status = b.status === 'lost' || b.status === 'spotted' ? b.status : fail('Status must be "lost" or "spotted".');
        const lat = Number(b.lat), lng = Number(b.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) fail('Please set a location on the map.');
        const linked = status === 'spotted' && b.linkedTo ? d.reports.find((r) => r.id === b.linkedTo && r.status === 'lost') : null;
        const ownerToken = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join('');
        const report = {
          id: newId(), status, reunited: false, reunitedAt: null, name: clean(b.name, 60), breed: clean(b.breed, 80),
          color: clean(b.color, 120), description: clean(b.description, 1000), photo: b.photo || null, seenAt: iso(b.seenAt),
          lat, lng, locationLabel: clean(b.locationLabel, 120), contactName: clean(b.contactName, 80),
          contactPhone: clean(b.contactPhone, 40), contactEmail: clean(b.contactEmail, 120), linkedTo: linked ? linked.id : null,
          sightings: [], sample: false, createdAt: new Date().toISOString(), ownerToken,
        };
        d.reports.push(report);
        if (linked) linked.sightings.push({ id: newId(), lat, lng, seenAt: report.seenAt, note: report.description || `Spotted report: ${report.breed} ${report.color}`.trim(),
          contactName: report.contactName, contact: report.contactPhone || report.contactEmail, photo: report.photo, reportId: report.id, createdAt: report.createdAt });
        save(d);
        return { report: pub(report), ownerToken };
      },
      async reunite(id, token) {
        await pause();
        const d = load(); const r = d.reports.find((x) => x.id === id) || fail('Report not found.');
        if (r.ownerToken && token !== r.ownerToken) fail('Only the person who filed this report can mark it reunited (owner key required).');
        r.reunited = true; r.reunitedAt = new Date().toISOString(); save(d); return pub(r);
      },
      async addSighting(id, b) {
        await pause();
        const d = load(); const r = d.reports.find((x) => x.id === id) || fail('Report not found.');
        if (r.status !== 'lost') fail('Sightings can only be added to lost dog reports.');
        r.sightings.push({ id: newId(), lat: Number(b.lat), lng: Number(b.lng), seenAt: iso(b.seenAt), note: clean(b.note, 600),
          contactName: clean(b.contactName, 80), contact: clean(b.contact, 120), photo: b.photo || null, reportId: null, createdAt: new Date().toISOString() });
        save(d); return pub(r);
      },
      reset() { localStorage.removeItem(STORE); },
    };
  }

  // ---------- pick one ----------
  const hasSupabase = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  async function serverAvailable() {
    if (window.Capacitor || !/^https?:$/.test(location.protocol) || /\.github\.io$/.test(location.hostname)) return false; // Android app / static hosting: no server
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
      const res = await fetch('api/health', { cache: 'no-store', signal: ctl.signal }); clearTimeout(t);
      return res.ok && (await res.json()).ok === true;
    } catch { return false; }
  }
  window.LostDogsData = {
    async init() {
      const want = cfg.backend || 'auto';
      if (want === 'supabase' || (want === 'auto' && hasSupabase)) {
        if (!hasSupabase) console.warn('backend=supabase but supabaseUrl / supabaseAnonKey are empty; using demo mode.');
        else return supabaseBackend();
      }
      if (want === 'server') return serverBackend;
      if (want === 'auto' && (await serverAvailable())) return serverBackend;
      return demoBackend();
    },
  };
})();
