// Shared by the browser and isolated PNG renderer. Only validated layer data enters here.
// Curvature is a signed sweep in percent: +/-100 is a half circle, zero is straight.
export function paintCurvedText(canvas, layer, family = layer.fontFamily) {
  const ctx = canvas.getContext('2d');
  const font = `${layer.fontWeight ?? 400} ${layer.fontSize}px "${family}"`;
  ctx.font = font;
  const measure = text => ctx.measureText(text).width;
  const graphemes = text => Array.from(new Intl.Segmenter(undefined, {granularity:'grapheme'}).segment(text), item => item.segment);
  const lines = [];
  for (const paragraph of layer.text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/).filter(Boolean)) {
      if (line && measure(line + word) > layer.width) { lines.push(line.trimEnd()); line = ''; }
      for (const char of graphemes(word)) {
        if (line && measure(line + char) > layer.width) { lines.push(line); line = ''; }
        if (line || char.trim()) line += char;
      }
    }
    lines.push(line);
  }
  const sweep = (layer.curvature ?? 0) * Math.PI / 100;
  const radius = layer.width / Math.max(Math.abs(sweep), .0001);
  const glyphs = [];
  let top = 0;
  for (const line of lines) {
    const chars = graphemes(line), row = [], lineWidth = measure(line);
    let advance = 0, previous = '';
    for (const char of chars) {
      const metrics = ctx.measureText(char);
      const kerned = previous ? measure(previous + char) - measure(previous) : metrics.width;
      const center = advance + kerned - metrics.width / 2;
      const theta = (center - lineWidth / 2) / radius;
      const direction = Math.sign(sweep);
      const angle = direction * theta;
      const x = radius * Math.sin(theta);
      const y = direction * radius * (1 - Math.cos(theta));
      const left = -(metrics.actualBoundingBoxLeft ?? 0) - metrics.width / 2;
      const right = (metrics.actualBoundingBoxRight ?? metrics.width) - metrics.width / 2;
      const ascent = metrics.actualBoundingBoxAscent ?? layer.fontSize;
      const descent = metrics.actualBoundingBoxDescent ?? layer.fontSize * .25;
      // Include the advance rectangle for whitespace, and two pixels of antialiasing room.
      const corners = [[Math.min(left,-metrics.width/2)-2,-ascent-2],[Math.max(right,metrics.width/2)+2,-ascent-2],[Math.min(left,-metrics.width/2)-2,descent+2],[Math.max(right,metrics.width/2)+2,descent+2]];
      const bounds = corners.map(([a,b]) => [x+a*Math.cos(angle)-b*Math.sin(angle),y+a*Math.sin(angle)+b*Math.cos(angle)]);
      row.push({char,x,y,angle,width:metrics.width,bounds});
      advance += kerned; previous = char;
    }
    if (!row.length) { top += layer.fontSize * 1.2; continue; }
    const points = row.flatMap(g => g.bounds);
    const minX = Math.min(...points.map(p=>p[0])), maxX = Math.max(...points.map(p=>p[0]));
    const minY = Math.min(...points.map(p=>p[1])), maxY = Math.max(...points.map(p=>p[1]));
    const scale = Math.min(1, layer.width / Math.max(1,maxX-minX));
    const offset = layer.align==='center' ? (layer.width-(maxX-minX)*scale)/2 : layer.align==='right' ? layer.width-(maxX-minX)*scale : 0;
    for (const g of row) glyphs.push({...g,x:(g.x-minX)*scale+offset,y:(g.y-minY)*scale+top,scale});
    top += (maxY-minY)*scale + layer.fontSize*.25;
  }
  // Bound the intermediate bitmap before allocation, even for 1,000 newline characters.
  if (top > 1536) throw new Error('EXPORT_TEXT_OVERFLOW');
  canvas.width = Math.ceil(layer.width);
  canvas.height = Math.max(1,Math.ceil(top));
  ctx.font = font; ctx.fillStyle = layer.fill; ctx.textBaseline = 'alphabetic';
  for (const g of glyphs) {
    ctx.save();ctx.translate(g.x,g.y);ctx.rotate(g.angle);ctx.scale(g.scale,g.scale);
    ctx.fillText(g.char,-g.width/2,0);ctx.restore();
  }
  return canvas;
}
