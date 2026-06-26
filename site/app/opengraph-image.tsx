import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Clud Bug — AI PR review with project-aware skills. Install the GitHub App.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const PAPER = '#f3ecda';
const PAPER_WARM = '#ebe2cc';
const PAPER_SHADOW = '#d8cdb0';
const INK = '#2b2418';
const INK_SOFT = '#6b5a40';
const INK_FAINT = '#7e6840';
const LEAF = '#5a8a2e';

type FontWeight = 300 | 500;
type FontVariant = {
  name: string;
  data: ArrayBuffer;
  weight: FontWeight;
  style: 'normal' | 'italic';
};

// Fetch a single Google Font variant. Parses CSS2 output (which emits one
// @font-face block per (style × unicode-range subset)), picks the block whose
// font-style matches what we asked for AND whose unicode-range covers basic
// uppercase ASCII (U+0041 'A'), then downloads that block's woff2.
async function loadGoogleFont(
  family: string,
  cssParams: string,
  weight: FontWeight,
  style: 'normal' | 'italic',
): Promise<FontVariant> {
  const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:${cssParams}&display=swap`;
  const cssRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!cssRes.ok) throw new Error(`Google Fonts CSS for ${family} returned ${cssRes.status}`);
  const css = await cssRes.text();

  const blocks = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((m) => m[1]);
  const styleBlocks = blocks.filter((b) => {
    const m = b.match(/font-style:\s*([a-z]+)/);
    return m && m[1] === style;
  });
  if (styleBlocks.length === 0) {
    throw new Error(`No @font-face block for ${family} style=${style}`);
  }

  // Prefer a subset whose unicode-range explicitly covers basic uppercase ASCII.
  // We test for U+0041 ('A') being inside any of the listed ranges in the block.
  const basicLatin = styleBlocks.find((b) => coversBasicLatin(b));
  const chosen = basicLatin ?? styleBlocks[0];
  if (!basicLatin) {
    // Surfacing this in build/runtime logs without breaking the route.
    console.warn(`loadGoogleFont(${family}, ${style}): no basic-latin block detected, falling back to first match`);
  }

  const woffMatch = chosen.match(/url\((https:[^)]+\.woff2)\)\s+format\('woff2'\)/);
  if (!woffMatch) throw new Error(`No woff2 URL in chosen ${family}/${style} block`);
  const woffRes = await fetch(woffMatch[1]);
  if (!woffRes.ok) throw new Error(`woff2 fetch for ${family}/${style} returned ${woffRes.status}`);

  return { name: family, data: await woffRes.arrayBuffer(), weight, style };
}

// True if any unicode-range in the block includes U+0041 ('A').
function coversBasicLatin(block: string): boolean {
  const range = block.match(/unicode-range:\s*([^;]+);/);
  if (!range) return false;
  const segments = range[1].split(',').map((s) => s.trim());
  for (const seg of segments) {
    // Forms: U+0041, U+0020-007F, U+0041-005A
    const single = seg.match(/^U\+([0-9A-F]+)$/i);
    if (single && parseInt(single[1], 16) === 0x41) return true;
    const span = seg.match(/^U\+([0-9A-F]+)-([0-9A-F]+)$/i);
    if (span && parseInt(span[1], 16) <= 0x41 && parseInt(span[2], 16) >= 0x41) return true;
  }
  return false;
}

async function loadFonts(): Promise<FontVariant[]> {
  // ital,opsz,wght@0,9..144,300 = roman, optical-size axis 9-144, weight 300
  // ital,opsz,wght@1,9..144,300 = italic, same
  const [normal, italic, mono] = await Promise.all([
    loadGoogleFont('Fraunces', 'ital,opsz,wght@0,9..144,300', 300, 'normal'),
    loadGoogleFont('Fraunces', 'ital,opsz,wght@1,9..144,300', 300, 'italic'),
    loadGoogleFont('JetBrains Mono', 'wght@500', 500, 'normal'),
  ]);
  return [normal, italic, mono];
}

export default async function OG() {
  // If Google Fonts hiccups, fall back to satori's bundled defaults rather than
  // 500-ing — social-card unfurlers cache broken fetches for hours.
  let fonts: FontVariant[] = [];
  try {
    fonts = await loadFonts();
  } catch (err) {
    console.warn(`OG image font load failed; falling back to satori defaults: ${(err as Error).message}`);
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: PAPER,
          color: INK,
          fontFamily: 'Fraunces, serif',
          display: 'flex',
          padding: '72px 80px',
          position: 'relative',
        }}
      >
        {/* Top folio rule */}
        <div
          style={{
            position: 'absolute',
            top: 56,
            left: 80,
            right: 80,
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 18,
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            color: INK_FAINT,
          }}
        >
          <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: '0.05em' }}>
            A Field Guide to Code Specimens
          </span>
          <span>Vol. 0 · cludbug.dev</span>
        </div>

        {/* Bottom folio rule */}
        <div
          style={{
            position: 'absolute',
            bottom: 56,
            left: 80,
            right: 80,
            display: 'flex',
            justifyContent: 'space-between',
            borderTop: `1px solid ${INK_FAINT}`,
            paddingTop: 18,
            fontSize: 18,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: INK_FAINT,
          }}
        >
          <span>Install the GitHub App</span>
          <span>cludbug.dev</span>
        </div>

        {/* Left margin: plate number + bug */}
        <div
          style={{
            width: 280,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            paddingRight: 40,
            borderRight: `1px solid ${INK_FAINT}`,
          }}
        >
          <div style={{ fontSize: 28, letterSpacing: '0.2em', textTransform: 'uppercase', color: INK_SOFT }}>
            Plate
          </div>
          <div
            style={{
              fontSize: 96,
              fontStyle: 'italic',
              fontWeight: 300,
              color: INK,
              lineHeight: 1,
              marginTop: 8,
            }}
          >
            № I
          </div>
          <div
            style={{
              fontSize: 220,
              marginTop: 36,
              transform: 'rotate(-12deg)',
              transformOrigin: 'center',
            }}
          >
            🐛
          </div>
        </div>

        {/* Right column: title block */}
        <div
          style={{
            flex: 1,
            paddingLeft: 56,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontSize: 168,
              lineHeight: 0.88,
              fontWeight: 300,
              letterSpacing: '-0.035em',
              color: INK,
            }}
          >
            Clud <span style={{ fontStyle: 'italic', color: LEAF }}>Bug</span>.
          </div>
          <div
            style={{
              fontSize: 38,
              fontStyle: 'italic',
              fontWeight: 300,
              color: INK_SOFT,
              marginTop: 28,
              maxWidth: 640,
              lineHeight: 1.2,
            }}
          >
            AI PR review with project-aware skills.
          </div>
          <div
            style={{
              fontSize: 22,
              fontStyle: 'italic',
              color: INK_FAINT,
              marginTop: 12,
              letterSpacing: '0.04em',
            }}
          >
            — Cluddus bugfindii, observed crawling on every PR.
          </div>

          {/* Primary CTA pill — leaf-green on cream, matches the in-page button */}
          <div
            style={{
              marginTop: 44,
              padding: '20px 32px',
              background: LEAF,
              color: PAPER,
              border: `1px solid ${INK}`,
              boxShadow: `8px 8px 0 ${PAPER_SHADOW}`,
              fontStyle: 'italic',
              fontSize: 34,
              fontWeight: 500,
              alignSelf: 'flex-start',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <span style={{ marginRight: 18, fontFamily: '"JetBrains Mono", monospace', fontStyle: 'normal', fontWeight: 700, color: PAPER_WARM }}>→</span>
            Install the GitHub App
          </div>
        </div>
      </div>
    ),
    { ...size, fonts, emoji: 'twemoji' },
  );
}
