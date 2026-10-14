import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => sessionStorage.setItem('sgrs:idf-view:demo-admin', JSON.stringify({ selectedId: 'idf-3', tab: 'qr' })));
  await page.goto('http://127.0.0.1:3000/?demo=1#idf');
  const overview = page.locator('.idf-cards.is-overview');
  const generalLog = page.getByRole('table', { name: 'Bitácora consolidada de visitas a IDFs' });
  await expect(overview).toBeVisible();
  await expect(generalLog).toBeVisible();
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
  const sidebar = page.locator('#desktop-sidebar');
  await sidebar.getByRole('link', { name: /^Registro IDF/ }).click();
  await expect(overview).toBeVisible();
  await expect(generalLog).toBeVisible();
  await cards.nth(0).click();
  await inventoryTab.click();
  await sidebar.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await sidebar.getByRole('link', { name: /^Registro IDF/ }).click();
  await expect(overview).toBeVisible();
  await expect(generalLog).toBeVisible();
  await cards.nth(0).click();
  await page.reload();
  await expect(overview).toBeVisible();
  await expect(generalLog).toBeVisible();
  console.log('PASS: IDF entry and sidebar re-entry show all cabinets and general log; selecting another IDF preserves its current tab.');
} finally {
  await browser.close();
}
