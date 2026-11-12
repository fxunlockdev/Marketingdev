/** Deterministic synthetic brand assets for the quality harness: approved product or premises
 * photo, logo, stock photo and the locked mood board's images. Drawn from SVG so no third-party
 * picture is redistributed. Live runs may replace them with real files (see docs/QUALITY.md). */
import sharp from 'sharp';

const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
const jpeg = (w, h, body) => sharp(svg(w, h, body)).jpeg({quality: 92}).toBuffer();
const png = (w, h, body) => sharp(svg(w, h, body)).png().toBuffer();

const PRODUCT = {
  backpack: '<rect width="100%" height="100%" fill="#ECE8E1"/><rect x="560" y="380" width="480" height="760" rx="90" fill="#151515"/><rect x="640" y="760" width="320" height="260" rx="40" fill="#1f1f1f"/><rect x="690" y="300" width="220" height="120" rx="60" fill="none" stroke="#151515" stroke-width="36"/><rect x="900" y="1040" width="90" height="34" fill="#ECE8E1"/>',
  coffee: '<rect width="100%" height="100%" fill="#F3E6D0"/><ellipse cx="800" cy="1050" rx="420" ry="90" fill="#e7d6bb"/><ellipse cx="800" cy="900" rx="300" ry="190" fill="#b86a2c"/><path d="M560 880 q240 -200 480 0" stroke="#7a3f17" stroke-width="26" fill="none"/>',
  groomer: '<rect width="100%" height="100%" fill="#8CC8EA"/><rect x="0" y="1100" width="1600" height="500" fill="#d9eef9"/><rect x="200" y="300" width="560" height="160" fill="#ffffff"/><text x="230" y="410" font-family="Arial" font-weight="800" font-size="90" fill="#D7262E">Brush &amp; Bark</text><rect x="1000" y="500" width="380" height="600" fill="#D7262E"/>',
};
const LOGO = {
  backpack: ['#111111', 'NORTHLINE'],
  coffee: ['#3B2416', 'EMBER &amp; OAT'],
  groomer: ['#D7262E', 'brush &amp; bark'],
};

export async function productPhoto(key) {
  return jpeg(1600, 1600, PRODUCT[key]);
}
/** A wordmark on white, as most owners upload it (JPEG, no transparency). */
export async function logo(key) {
  const [colour, word] = LOGO[key];
  return jpeg(1200, 400, `<rect width="100%" height="100%" fill="#ffffff"/><text x="600" y="250" text-anchor="middle" font-family="Arial" font-weight="700" font-size="120" letter-spacing="8" fill="${colour}">${word}</text>`);
}
export async function stockPhoto() {
  return jpeg(3000, 2000, '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfd8de"/><stop offset="1" stop-color="#9aa3a8"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#s)"/><rect x="300" y="200" width="300" height="1500" fill="#e9e5de"/><rect x="900" y="200" width="300" height="1500" fill="#e9e5de"/><rect x="0" y="1500" width="3000" height="500" fill="#d8d3cb"/><rect x="2100" y="100" width="500" height="1400" fill="#7f97a8"/>');
}
/** The locked mood board's preview image and its carousel cover (both PNG, as stored). */
export async function moodboardImages(business) {
  const [a, b, c] = business.moodboard.direction.palette.map(p => p.hex);
  const image = await png(1024, 1280, `<rect width="100%" height="100%" fill="${a}"/><rect x="90" y="120" width="844" height="760" fill="${c}" opacity="0.55"/><text x="90" y="1060" font-family="Georgia" font-size="88" fill="${b}">Mood board</text>`);
  const cover = await png(1024, 1280, `<rect width="100%" height="100%" fill="${b}"/><circle cx="512" cy="560" r="300" fill="${a}"/><text x="90" y="1150" font-family="Georgia" font-size="72" fill="${a}">Cover</text>`);
  return {image, cover};
}
export async function referenceSet(business, roles) {
  const out = [];
  for (const role of roles) {
    if (role === 'logo') out.push({role, label: `${business.name} logo`, bytes: await logo(business.key)});
    else out.push({role, label: role === 'premises' ? `${business.name} studio premises photo` : `${business.name} product photo`, bytes: await productPhoto(business.key)});
  }
  return out;
}
