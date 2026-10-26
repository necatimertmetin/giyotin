import { expect, test } from '@playwright/test';

// Browser-only build served by `vite preview --mode pages` under /giyotin/.

test('the static build works without any server: seed data, plan, confirm, persistence', async ({ page }) => {
  const apiCalls: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) apiCalls.push(r.url());
  });

  await page.goto('./');
  await expect(page).toHaveTitle('Giyotin');
  await expect(page.getByTestId('local-note')).toBeVisible();
  // Sample data is seeded into the browser database on the first visit.
  await expect(page.getByText('Kullanılabilir tabaka')).toBeVisible();

  await page.getByRole('link', { name: 'Yeni Kesim İşi' }).click();
  await page.getByTestId('order-select').click();
  await page.getByRole('option', { name: /Broşür seti/ }).click();
  await page.getByTestId('next-step').click();
  await expect(page.getByTestId('results')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('fulfilled-banner').first()).toContainText('tamamen karşılanabiliyor');

  await page.getByTestId('open-confirm').click();
  await page.getByTestId('confirm-plan').click();
  await expect(page).toHaveURL(/#\/gecmis\/\d+/);

  // Everything is stored in IndexedDB: a reload keeps the confirmed job.
  await page.waitForTimeout(800);
  await page.reload();
  await page.goto('./#/gecmis');
  await expect(page.getByTestId('history-row')).toHaveCount(1);

  expect(apiCalls).toEqual([]);
});
