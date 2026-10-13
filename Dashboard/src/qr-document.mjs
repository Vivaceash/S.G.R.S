const loadImage = source => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('No se pudo cargar la plantilla o un código QR.'));
  image.src = source;
});

// Letter pages with a proportionally scaled poster and a white printer margin.
export async function createQrDocument(templateSource, entries) {
  const images = await createQrPrintPages(templateSource, entries);
  const pages = images.map(source => {
    const binary = atob(source.split(',')[1]);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  });
  return imagePagesPdf(pages);
}

// Browser-native printing uses HTML images instead of the PDF viewer/plugin.
export async function createQrPrintPages(templateSource, entries) {
  if (!entries.length) throw new Error('No hay IDF disponibles para el documento.');
  const background = await loadImage(templateSource);
  await document.fonts.ready;
  const pages = [];
  for (const entry of entries) {
    const qr = await loadImage(entry.source);
    const canvas = document.createElement('canvas');
    canvas.width = 1700;
    canvas.height = 2200;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(1660 / background.width, 2160 / background.height);
    const width = background.width * scale;
    const height = background.height * scale;
    const x = (canvas.width - width) / 2;
    const y = (canvas.height - height) / 2;
    ctx.drawImage(background, x, y, width, height);
    const qrSize = width * .404;
    const qrX = x + width * .298;
    const qrY = y + height * .604;
    const inset = width * .032;
    ctx.fillStyle = '#fff';
    ctx.fillRect(qrX, qrY, qrSize, qrSize);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(qr, qrX + inset, qrY + inset, qrSize - inset * 2, qrSize - inset * 2);
    ctx.fillStyle = '#111';
    ctx.font = `800 ${Math.round(width * .033)}px Montserrat, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(entry.label, canvas.width / 2, y + height * .94, width * .85);
    pages.push(canvas.toDataURL('image/jpeg', .96));
  }
  return pages;
}

// A minimal PDF containing only JPEG page images: no library or server changes.
function imagePagesPdf(pages) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  let length = 0;
  const append = value => {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id, body) => {
    offsets[id] = length;
    append(`${id} 0 obj\n${body}\nendobj\n`);
  };
  append('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  pages.forEach((jpeg, index) => {
    const id = 3 + index * 3;
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Poster ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    offsets[id + 1] = length;
    append(`${id + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width 1700 /Height 2200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    append(jpeg);
    append('\nendstream\nendobj\n');
    const commands = 'q\n612 0 0 792 0 0 cm\n/Poster Do\nQ\n';
    object(id + 2, `<< /Length ${encoder.encode(commands).length} >>\nstream\n${commands}endstream`);
  });
  const start = length;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach(offset => append(`${String(offset).padStart(10, '0')} 00000 n \n`));
  append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
