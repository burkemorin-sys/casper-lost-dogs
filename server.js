// Community Lost Dog Tracker - zero-dependency Node.js server
// Stores reports in data/db.json and photos in uploads/.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildSeed } = require('./seed');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_BODY = 8 * 1024 * 1024; // 8 MB (photos are resized client-side)

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- storage ----------
let db;
function loadDb() {
  if (process.argv.includes('--reset') || process.argv.includes('--reset-only') || !fs.existsSync(DB_FILE)) {
    db = { reports: buildSeed() };
    saveDb();
    console.log('Seeded database with sample reports.');
  } else {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  }
}
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE); // atomic replace
}
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newId = () => crypto.randomBytes(6).toString('hex');

// Strip private fields before sending to clients
function publicReport(r) {
  const { ownerTokenHash, ...rest } = r;
  return { ...rest, ownerProtected: !!ownerTokenHash };
}

// ---------- validation helpers ----------
const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function num(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function isoDate(v) {
  const d = new Date(v);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
}
function savePhoto(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:image\/(jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw httpError(400, 'Photo must be a JPEG, PNG, WebP or GIF image.');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) throw httpError(413, 'Photo is too large (max 6 MB).');
  const name = `${Date.now()}-${newId()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return `/uploads/${name}`;
}
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// ---------- HTTP plumbing ----------
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : headers['Content-Type'] || 'text/plain',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(httpError(413, 'Request too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(httpError(400, 'Invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.json': 'application/json', '.ico': 'image/x-icon', '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
};
function serveStatic(res, baseDir, relPath) {
  const filePath = path.normalize(path.join(baseDir, relPath));
  if (!filePath.startsWith(baseDir)) return send(res, 403, 'Forbidden');
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': baseDir === UPLOAD_DIR ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ---------- API ----------
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api','reports',id,action]

  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true });

  if (parts[1] !== 'reports') throw httpError(404, 'Not found');

  // GET /api/reports
  if (req.method === 'GET' && parts.length === 2) {
    const list = [...db.reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return send(res, 200, list.map(publicReport));
  }

  // POST /api/reports  -> create lost/spotted report
  if (req.method === 'POST' && parts.length === 2) {
    const b = await readJson(req);
    const status = b.status === 'lost' ? 'lost' : b.status === 'spotted' ? 'spotted' : null;
    if (!status) throw httpError(400, 'Status must be "lost" or "spotted".');
    const lat = num(b.lat, -90, 90), lng = num(b.lng, -180, 180);
    if (lat === null || lng === null) throw httpError(400, 'Please set a location on the map.');
    const contactName = str(b.contactName, 80), contactPhone = str(b.contactPhone, 40), contactEmail = str(b.contactEmail, 120);
    if (!contactName || (!contactPhone && !contactEmail)) throw httpError(400, 'Contact name and a phone or email are required.');
    const name = str(b.name, 60);
    if (status === 'lost' && !name) throw httpError(400, "Please enter the dog's name.");
    const linkedTo = status === 'spotted' && b.linkedTo ? db.reports.find((r) => r.id === b.linkedTo && r.status === 'lost') : null;

    const ownerToken = crypto.randomBytes(16).toString('hex');
    const report = {
      id: newId(),
      status,
      reunited: false,
      reunitedAt: null,
      name,
      breed: str(b.breed, 80),
      color: str(b.color, 120),
      description: str(b.description, 1000),
      photo: savePhoto(b.photo),
      seenAt: isoDate(b.seenAt),
      lat, lng,
      locationLabel: str(b.locationLabel, 120),
      contactName, contactPhone, contactEmail,
      linkedTo: linkedTo ? linkedTo.id : null,
      sightings: [],
      sample: false,
      createdAt: new Date().toISOString(),
      ownerTokenHash: hash(ownerToken),
    };
    db.reports.push(report);
    // A spotted report linked to a lost dog also becomes a sighting on that dog's trail
    if (linkedTo) {
      linkedTo.sightings.push({
        id: newId(), lat, lng, seenAt: report.seenAt, note: report.description || `Spotted report: ${report.breed} ${report.color}`.trim(),
        contactName, contact: contactPhone || contactEmail, photo: report.photo, reportId: report.id, createdAt: report.createdAt,
      });
    }
    saveDb();
    return send(res, 201, { report: publicReport(report), ownerToken });
  }

  const report = db.reports.find((r) => r.id === parts[2]);
  if (!report) throw httpError(404, 'Report not found.');

  // GET /api/reports/:id
  if (req.method === 'GET' && parts.length === 3) return send(res, 200, publicReport(report));

  // POST /api/reports/:id/reunite  { ownerToken }
  if (req.method === 'POST' && parts[3] === 'reunite') {
    const b = await readJson(req);
    if (report.ownerTokenHash && hash(b.ownerToken || '') !== report.ownerTokenHash)
      throw httpError(403, 'Only the person who filed this report can mark it reunited (owner key required).');
    report.reunited = b.undo ? false : true;
    report.reunitedAt = report.reunited ? new Date().toISOString() : null;
    saveDb();
    return send(res, 200, publicReport(report));
  }

  // POST /api/reports/:id/sightings  -> "I saw this dog"
  if (req.method === 'POST' && parts[3] === 'sightings') {
    if (report.status !== 'lost') throw httpError(400, 'Sightings can only be added to lost dog reports.');
    const b = await readJson(req);
    const lat = num(b.lat, -90, 90), lng = num(b.lng, -180, 180);
    if (lat === null || lng === null) throw httpError(400, 'Please set where you saw the dog on the map.');
    const contactName = str(b.contactName, 80);
    const contact = str(b.contact, 120);
    const sighting = {
      id: newId(), lat, lng, seenAt: isoDate(b.seenAt), note: str(b.note, 600),
      contactName, contact, photo: savePhoto(b.photo), reportId: null, createdAt: new Date().toISOString(),
    };
    report.sightings.push(sighting);
    saveDb();
    return send(res, 201, publicReport(report));
  }

  throw httpError(404, 'Not found');
}

// ---------- server ----------
loadDb();
if (process.argv.includes('--reset-only')) process.exit(0);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    if (url.pathname.startsWith('/uploads/')) return serveStatic(res, UPLOAD_DIR, decodeURIComponent(url.pathname.slice(9)));
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname);
    return serveStatic(res, PUBLIC_DIR, rel);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    send(res, status, { error: status === 500 ? 'Server error' : err.message });
  }
});
server.listen(PORT, () => console.log(`Lost Dogs tracker running at http://localhost:${PORT}`));
