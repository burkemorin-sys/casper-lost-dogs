// Generates simple, friendly SVG dog portraits for the sample reports.
const fs = require('fs');
const path = require('path');
const dogs = [
  { bg: '#FDE7C8', fur: '#E0A040', ear: '#C9822A', collar: '#D63A3A', label: 'Biscuit' },
  { bg: '#DCE8F2', fur: '#7F93A6', ear: '#3D4A57', collar: '#2F2F2F', label: 'Ranger', patch: true },
  { bg: '#E7F0E1', fur: '#FFFFFF', ear: '#222222', collar: '#4A90D9', label: 'Pepper', blaze: '#222222' },
  { bg: '#F5E1D5', fur: '#6B3F22', ear: '#4E2C17', collar: null, label: 'Spotted' },
  { bg: '#E6E9F5', fur: '#B9C0C9', ear: '#6E7781', collar: '#3BA55C', label: 'Spotted', mask: true },
  { bg: '#FBE3DA', fur: '#B5562B', ear: '#8A3C1A', collar: '#E8A33D', label: 'Daisy', longEars: true },
];
const out = path.join(__dirname, 'public', 'samples');
fs.mkdirSync(out, { recursive: true });
dogs.forEach((d, i) => {
  const ears = d.longEars
    ? `<ellipse cx="118" cy="150" rx="26" ry="58" fill="${d.ear}"/><ellipse cx="282" cy="150" rx="26" ry="58" fill="${d.ear}"/>`
    : `<path d="M110 80 L150 150 L95 165 Z" fill="${d.ear}"/><path d="M290 80 L250 150 L305 165 Z" fill="${d.ear}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
  <rect width="400" height="300" fill="${d.bg}"/>
  <circle cx="60" cy="250" r="70" fill="#ffffff" opacity=".35"/><circle cx="350" cy="40" r="50" fill="#ffffff" opacity=".35"/>
  ${d.collar ? `<rect x="140" y="232" width="120" height="18" rx="9" fill="${d.collar}"/><circle cx="200" cy="258" r="10" fill="#F2C94C"/>` : ''}
  ${ears}
  <ellipse cx="200" cy="160" rx="92" ry="82" fill="${d.fur}" stroke="#00000014" stroke-width="3"/>
  ${d.blaze ? `<path d="M120 120 Q160 80 190 95 L190 150 Q150 160 120 150Z" fill="${d.blaze}"/><path d="M280 120 Q240 80 210 95 L210 150 Q250 160 280 150Z" fill="${d.blaze}"/>` : ''}
  ${d.mask ? `<path d="M120 150 Q200 90 280 150 Q240 130 200 135 Q160 130 120 150Z" fill="#6E7781"/>` : ''}
  ${d.patch ? `<ellipse cx="166" cy="145" rx="26" ry="22" fill="#2B3540"/>` : ''}
  <ellipse cx="200" cy="200" rx="48" ry="36" fill="#FFF6EA"/>
  <circle cx="166" cy="146" r="10" fill="#2B1B10"/><circle cx="234" cy="146" r="10" fill="#2B1B10"/>
  <circle cx="169" cy="143" r="3" fill="#fff"/><circle cx="237" cy="143" r="3" fill="#fff"/>
  <ellipse cx="200" cy="186" rx="16" ry="11" fill="#2B1B10"/>
  <path d="M200 197 L200 210 M184 214 Q200 226 216 214" stroke="#2B1B10" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M196 218 Q200 236 208 218" fill="#E86A6A"/>
  <rect x="10" y="10" width="92" height="28" rx="14" fill="#00000066"/>
  <text x="56" y="29" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">SAMPLE</text>
</svg>`;
  fs.writeFileSync(path.join(out, `dog-${i + 1}.svg`), svg);
});
console.log('Wrote', dogs.length, 'sample images to', out);
