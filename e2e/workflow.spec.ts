import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'test-results/shots';

async function addSheetStock(page: Page, name: string, width: string, height: string, quantity: string): Promise<void> {
  await page.getByTestId('add-stock').click();
  await page.getByTestId('stock-name').fill(name);
  await page.getByTestId('stock-width').fill(width);
  await page.getByTestId('stock-height').fill(height);
  await page.getByTestId('stock-quantity').fill(quantity);
  await page.getByTestId('stock-save').click();
  await expect(page.getByTestId('stock-save')).toBeHidden();
}

async function fillLine(page: Page, index: number, name: string, width: string, height: string, qty: string): Promise<void> {
  await page.getByTestId(`line-name-${index}`).fill(name);
  await page.getByTestId(`line-width-${index}`).fill(width);
  await page.getByTestId(`line-height-${index}`).fill(height);
  await page.getByTestId(`line-qty-${index}`).fill(qty);
}

test.describe.configure({ mode: 'serial' });

// The machine is asked for on first start; these tests configure it through the API instead.
test.beforeAll(async ({ request }) => {
  await request.put('/api/machine', { data: { name: null, bladeLength: 1600 } });
});

test('order → plan → preview → confirm → offcut reuse', async ({ page }) => {
  // 1. Inventory: one 700×500 sheet.
  await page.goto('/envanter');
  await addSheetStock(page, 'Test Kuşe 135', '700', '500', '1');
  await expect(page.getByTestId('stock-row')).toHaveCount(1);
  await expect(page.getByTestId('stock-row').first()).toContainText('Test Kuşe 135');

  // Validation: zero dimensions are rejected with a message.
  await page.getByTestId('add-stock').click();
  await page.getByTestId('stock-name').fill('Hatalı');
  await page.getByTestId('stock-width').fill('0');
  await page.getByTestId('stock-save').click();
  await expect(page.getByTestId('stock-error')).toBeVisible();
  await page.keyboard.press('Escape');

  // 2. New job: one poster.
  await page.goto('/yeni-is');
  await page.getByTestId('order-name').fill('E2E sipariş 1');
  await fillLine(page, 0, 'Poster', '300', '300', '1');
  await page.getByTestId('run-optimizer').click();
  await expect(page.getByTestId('results')).toBeVisible();
  await expect(page.getByTestId('fulfilled-banner').first()).toContainText('tamamen karşılanabiliyor');
  await expect(page.getByTestId('heuristic-note').first()).toContainText('kanıtlanmış değildir');
  await page.screenshot({ path: `${SHOTS}/01-newjob-results.png`, fullPage: true });

  // Preview must not consume stock.
  await page.goto('/envanter');
  await expect(page.getByTestId('stock-row').first()).toContainText('1');
  await expect(page.getByText('Tükendi')).toHaveCount(0);

  // 3. Re-run and inspect the plan.
  await page.goto('/yeni-is');
  await page.getByTestId('order-name').fill('E2E sipariş 1');
  await fillLine(page, 0, 'Poster', '300', '300', '1');
  await page.getByTestId('run-optimizer').click();
  await expect(page.getByTestId('results')).toBeVisible();
  await expect(page.getByTestId('sheet-svg')).toBeVisible();
  await expect(page.locator('[data-testid="sheet-svg"] rect[style*="cursor: pointer"]').first()).toBeVisible();

  // Selecting a piece reveals its details.
  await page.locator('[data-testid="sheet-svg"] rect[fill^="hsl"]').first().click();
  await expect(page.getByTestId('selection-info')).toContainText('Poster');
  await expect(page.getByTestId('selection-info')).toContainText('300');

  // Step-by-step mode follows the cut tree.
  await page.getByTestId('step-next').click();
  await expect(page.getByTestId('step-counter')).toContainText('Adım 1 /');
  await expect(page.getByTestId('step-description')).toContainText('Kesim #1');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/02-plan-steps.png`, fullPage: true });

  // 4. Confirm: stock is consumed, offcuts are approved.
  await page.getByTestId('open-confirm').click();
  await page.getByTestId('confirm-plan').click();
  await expect(page).toHaveURL(/\/gecmis\/\d+/);
  await expect(page.getByTestId('job-offcuts')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-job-detail.png`, fullPage: true });

  await page.goto('/envanter');
  await expect(page.getByText('Tükendi')).toHaveCount(1);

  // The offcuts were approved during confirmation.
  await page.goto('/artiklar');
  const offcutRows = page.getByTestId('stock-row');
  await expect(offcutRows.first()).toBeVisible();
  const offcutCount = await offcutRows.count();
  expect(offcutCount).toBeGreaterThan(0);
  await page.screenshot({ path: `${SHOTS}/04-offcuts.png`, fullPage: true });

  // 5. Second job can only be satisfied from the offcut (sheet stock is gone).
  await page.goto('/yeni-is');
  await page.getByTestId('order-name').fill('E2E sipariş 2');
  await fillLine(page, 0, 'Kart', '90', '50', '4');
  await page.getByTestId('run-optimizer').click();
  await expect(page.getByTestId('results')).toBeVisible();
  await expect(page.getByTestId('fulfilled-banner').first()).toContainText('tamamen karşılanabiliyor');
  await expect(page.getByTestId('plan-stats').first().getByText('artık').first()).toBeVisible();
  await page.getByTestId('open-confirm').click();
  await page.getByTestId('confirm-plan').click();
  await expect(page).toHaveURL(/\/gecmis\/\d+/);

  // 6. History keeps both jobs.
  await page.goto('/gecmis');
  await expect(page.getByTestId('history-row')).toHaveCount(2);
  await page.getByTestId('history-row').last().click();
  await expect(page.getByTestId('sheet-svg')).toBeVisible();
});

test('double confirmation is impossible from the UI/API', async ({ request, page }) => {
  const stock = await request.post('/api/stock', {
    data: { kind: 'sheet', name: 'Çift onay kağıdı', width: 500, height: 500, quantity: 3, allowRotation: true, grain: 'none', status: 'active' },
  });
  expect(stock.ok()).toBeTruthy();
  const run = await (await request.post('/api/optimize', {
    data: {
      orderId: null,
      lines: [{ name: 'X', width: 100, height: 100, quantity: 5, notes: null, allowRotation: true, materialKey: null, grain: 'any', minWidth: null, minHeight: null }],
      settings: { kerf: 3, edgeMargin: 0, minOffcutWidth: 100, minOffcutHeight: 100, maxRuntimeMs: 5000, searchWidth: 3, costWeight: 0, seed: 1 },
    },
  })).json();
  const body = { planId: run.result.plans[0].id, approvedOffcuts: [] };
  expect((await request.post(`/api/runs/${run.id}/confirm`, { data: body })).status()).toBe(201);
  expect((await request.post(`/api/runs/${run.id}/confirm`, { data: body })).status()).toBe(409);
  await page.goto(`/plan/${run.id}`);
  await expect(page.getByText('Bu plan onaylandı')).toBeVisible();
});

test('changing the kerf and re-running changes the plan; the sample sheet follows the settings', async ({ page, request }) => {
  await request.post('/api/stock', {
    data: { kind: 'sheet', name: 'Kerf kağıdı', width: 600, height: 600, quantity: 20, allowRotation: true, grain: 'none', status: 'active' },
  });
  await page.goto('/yeni-is');
  await page.getByTestId('order-name').fill('Kerf testi');
  await fillLine(page, 0, 'Kutu', '100', '100', '30');

  // Plans are calculated automatically; the live sample sheet is drawn with the real engine and reacts to the kerf.
  await expect(page.getByTestId('results')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/05-settings-step.png`, fullPage: true });
  const kerfMetric = page.getByTestId('plan-stats').first().locator('text=Bıçak payı').locator('xpath=..');
  const loss12 = await kerfMetric.innerText();

  // Settings and plans share one page: changing the kerf recalculates the plans automatically.
  await page.getByTestId('setting-kerf').fill('2');
  await expect.poll(async () => kerfMetric.innerText(), { timeout: 20_000 }).not.toBe(loss12);
});

test('settings can be saved as a profile and applied again', async ({ page }) => {
  await page.goto('/yeni-is');
  await page.getByTestId('order-name').fill('Profil testi');
  await fillLine(page, 0, 'Kutu', '100', '100', '4');

  await page.getByTestId('setting-kerf').fill('2');
  await page.getByTestId('trim-on').click();
  await expect(page.getByTestId('profile-state')).toContainText('kaydedilmedi');
  await page.getByTestId('profile-name').fill('Hassas kesim');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-state')).toContainText('Hassas kesim');

  // Switch back to the standard profile, then re-apply the saved one.
  await page.getByTestId('profile-chip-Standart').click();
  await expect(page.getByTestId('setting-kerf')).toHaveValue('3');
  await page.getByTestId('profile-chip-Hassas kesim').click();
  await expect(page.getByTestId('setting-kerf')).toHaveValue('2');
  await expect(page.getByTestId('profile-state')).toContainText('Hassas kesim');

  // Profiles are stored on the server and survive a reload.
  await page.reload();
  await page.getByTestId('order-name').fill('Profil testi');
  await fillLine(page, 0, 'Kutu', '100', '100', '4');
  await expect(page.getByTestId('profile-chip-Hassas kesim')).toBeVisible();
});

test('the whole database can be wiped, but only after typing the confirmation word', async ({ page, request }) => {
  await request.post('/api/stock', {
    data: { kind: 'sheet', name: 'Silinecek kağıt', width: 500, height: 500, quantity: 3, allowRotation: true, grain: 'none', status: 'active' },
  });
  await page.goto('/');
  await page.getByTestId('open-reset').click();
  await expect(page.getByTestId('reset-confirm')).toBeDisabled();
  await page.getByTestId('reset-confirm-input').fill('yanlış');
  await expect(page.getByTestId('reset-confirm')).toBeDisabled();
  await page.getByTestId('reset-confirm-input').fill('sil');
  await expect(page.getByTestId('reset-confirm')).toBeEnabled();
  await page.getByTestId('reset-confirm').click();
  await expect(page.getByText('Tüm veriler silindi.')).toBeVisible();
  // The machine went with the data, so it is asked for again.
  await expect(page.getByTestId('machine-setup')).toBeVisible();
  await page.getByTestId('machine-blade').fill('1600');
  await page.getByTestId('machine-save').click();
  await expect(page.getByTestId('machine-setup')).toBeHidden();

  const stock = await (await request.get('/api/stock')).json();
  expect(stock).toHaveLength(0);
  await page.goto('/gecmis');
  await expect(page.getByText('Henüz onaylanmış iş yok')).toBeVisible();
});

test('artwork files dropped on the order become products with size and preview', async ({ page }) => {
  await page.goto('/envanter');
  await addSheetStock(page, 'Çizim testi', '700', '500', '5');

  await page.goto('/yeni-is');
  await page.getByTestId('import-artwork-input').setInputFiles(['e2e/fixtures/kartvizit-ve-davetiye.pdf', 'e2e/fixtures/etiket.svg', 'e2e/fixtures/afis.cdr']);

  // Corel cannot be read; the user is told to export a PDF. The other files become rows (the blank row is replaced).
  await expect(page.getByRole('alert')).toContainText('CorelDRAW');
  await expect(page.getByTestId('line-name-0')).toHaveValue('kartvizit-ve-davetiye (1)');
  // Page 1 has a 3 mm bleed: the size comes from its trim box, not the media box.
  await expect(page.getByTestId('line-width-0')).toHaveValue('85');
  await expect(page.getByTestId('line-height-0')).toHaveValue('55');
  await expect(page.getByTestId('line-name-1')).toHaveValue('kartvizit-ve-davetiye (2)');
  await expect(page.getByTestId('line-width-1')).toHaveValue('148');
  await expect(page.getByTestId('line-height-1')).toHaveValue('210');
  await expect(page.getByTestId('line-name-2')).toHaveValue('etiket');
  await expect(page.getByTestId('line-width-2')).toHaveValue('100');
  await expect(page.getByTestId('line-height-2')).toHaveValue('70');
  await expect(page.getByTestId('line-qty-0')).toHaveValue('1');
  await expect(page.getByTestId('line-name-3')).toHaveCount(0);
  for (const i of [0, 1, 2]) await expect(page.getByTestId(`line-artwork-${i}`)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/20-artwork-import.png`, fullPage: true });

  await page.getByTestId('line-qty-0').fill('20');
  await page.getByTestId('run-optimizer').click();
  await expect(page.getByTestId('sheet-svg')).toBeVisible();
  // The plan draws the product previews on the pieces.
  await expect(page.locator('[data-testid="sheet-svg"] image').first()).toBeAttached();
  await page.screenshot({ path: `${SHOTS}/21-artwork-plan.png`, fullPage: true });

  // Saved orders keep their previews.
  await page.getByTestId('order-name').fill('Çizimli sipariş');
  await page.getByTestId('save-order').click();
  await page.reload();
  await page.getByTestId('order-select').click();
  await page.getByRole('option', { name: /Çizimli sipariş/ }).click();
  await expect(page.getByTestId('line-artwork-0')).toBeVisible();
});
