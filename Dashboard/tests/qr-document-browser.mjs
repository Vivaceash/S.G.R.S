import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3000/?demo=1#idf');
  const cards = page.locator('.idf-card');
  const count = await cards.count();
  await cards.first().click();
  await page.getByRole('tab', { name: 'Código QR', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar documento PDF', exact: true }).click();
  const download = await downloadEvent;
  await mkdir('tmp/pdfs', { recursive: true });
  await download.saveAs('tmp/pdfs/qr-demo-review.pdf');
  // Intercept only the native dialog; exercise the real document/image loading.
  let printDownloads = 0;
  page.on('download', () => printDownloads++);
  await page.evaluate(() => {
    window.__printed = false;
    window.__appendFrame = document.body.appendChild.bind(document.body);
    document.body.appendChild = node => {
      if (node.tagName === 'IFRAME') {
        const onload = node.onload;
        node.onload = event => {
          node.contentWindow.print = () => {
            window.__printed = [...node.contentDocument.images].every(image => image.complete && image.naturalWidth > 0);
            window.__printPages = node.contentDocument.images.length;
          };
          return onload(event);
        };
      }
      return window.__appendFrame(node);
    };
  });
  await page.getByRole('button', { name: 'Imprimir todos los QR', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__printPages)).toBe(count);
  expect(printDownloads).toBe(0);
  console.log(`PASS: PDF download and direct HTML printing of ${count} loaded QR pages, without a download during printing.`);
} finally {
  await browser.close();
}
