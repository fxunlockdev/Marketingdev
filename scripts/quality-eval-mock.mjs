/** MOCK OpenAI transport for the quality harness. Images are labelled placeholders drawn from the
 * prompt (headline and brand colours) at the requested size; checks and the judge answer fixed,
 * clearly mock scores. Proves the plumbing only; it says nothing about model quality. */
import sharp from 'sharp';

const escapeXml = text => text.replace(/[<>&"']/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'}[c]));
const headlineOf = prompt => /Render this headline exactly, character for character, once: "((?:[^"\\]|\\.)*)"/.exec(prompt)?.[1] ?? '';

export async function placeholder(prompt, size) {
  const [width, height] = size.split('x').map(Number);
  const colours = [...new Set(prompt.match(/#[0-9a-fA-F]{6}/g) ?? [])];
  const [a, b, c] = [colours[0] ?? '#2b5d7a', colours[1] ?? '#f1ece4', colours[2] ?? '#d9772b'];
  const headline = escapeXml(headlineOf(prompt) || 'Overlay copy added later'), font = Math.round(width / 16);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${b}"/>
<rect x="${width * 0.1}" y="${height * 0.12}" width="${width * 0.8}" height="${height * 0.5}" fill="${a}" opacity="0.85"/><circle cx="${width * 0.68}" cy="${height * 0.38}" r="${width * 0.14}" fill="${c}"/>
<text x="${width * 0.1}" y="${height * 0.74}" font-family="Georgia" font-size="${font}" fill="${a}">${headline}</text>
<text x="${width * 0.1}" y="${height * 0.82}" font-family="Arial" font-size="${Math.round(font * 0.4)}" fill="${a}">MOCK image · quality harness · ${width}x${height}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function specOf(body) {
  const text = body.input?.[1]?.content?.[0]?.text ?? '';
  try {return JSON.parse(text.slice(text.indexOf('\n') + 1));} catch {return {};}
}

function responses(body) {
  const name = body.text?.format?.name, spec = specOf(body), expected = spec.expected_text ?? [];
  const answer = name === 'desvio_image_qa'
    ? {text_matches: true, found_text: expected, brief_fit: 4, brand_fit: 4, artefacts: [], verdict: 'pass'}
    : {brief_fit: 3, brand_palette: 3, brand_typography: 3, logo: 3, composition: 3, benchmark_likeness: 2, artefact_free: 4, found_text: expected, artefacts: [], notes: 'MOCK judgement: placeholder image, no quality signal.'};
  const text = JSON.stringify(answer);
  return {id: 'resp_mock', object: 'response', created_at: 1, status: 'completed', model: body.model, output_text: text,
    output: [{type: 'message', id: 'msg_mock', role: 'assistant', status: 'completed', content: [{type: 'output_text', text, annotations: []}]}],
    usage: {input_tokens: 1000, output_tokens: 200, total_tokens: 1200}};
}

/** A fetch for `new OpenAI({fetch})`. `log` receives one entry per request (kind, size, model). */
export function mockFetch(log = []) {
  return async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v1/responses') {
      const body = JSON.parse(init.body);
      log.push({kind: body.text?.format?.name ?? 'responses', model: body.model});
      return Response.json(responses(body));
    }
    const fields = {};
    if (init.body instanceof FormData) {for (const [k, v] of init.body.entries()) if (typeof v === 'string') fields[k] = v;}
    else Object.assign(fields, JSON.parse(init.body));
    log.push({kind: path.endsWith('edits') ? 'image-edit' : 'image-generate', model: fields.model, size: fields.size, quality: fields.quality});
    const png = await placeholder(fields.prompt ?? '', fields.size);
    return Response.json({created: 1, data: [{b64_json: png.toString('base64')}], usage: {input_tokens: 100, output_tokens: 1000, total_tokens: 1100}});
  };
}
