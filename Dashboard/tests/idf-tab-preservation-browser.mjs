import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3000/?demo=1#idf');
  const cards = page.locator('.idf-card');
  await cards.nth(0).click();
  const qrTab = page.getByRole('tab', { name: 'Código QR', exact: true });
  await qrTab.click();
  await expect(qrTab).toHaveAttribute('aria-selected', 'true');
  const firstLink = await page.locator('.idf-qr-panel .qr-url').getAttribute('href');
  await cards.nth(1).click();
  await expect(qrTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.idf-qr-panel')).toBeVisible();
  await expect(page.locator('.idf-qr-panel .qr-url')).not.toHaveAttribute('href', firstLink);
  const inventoryTab = page.getByRole('tab', { name: 'Inventario', exact: true });
  await inventoryTab.click();
  await cards.nth(2).click();
  await expect(inventoryTab).toHaveAttribute('aria-selected', 'true');
  console.log('PASS: switching IDF preserves QR/inventory tab and updates QR destination in demo.');
} finally {
  await browser.close();
}
