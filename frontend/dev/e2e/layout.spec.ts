import { expect, test } from './fixtures';

for (const theme of ['light', 'dark']) {
  for (const width of [390, 1440]) {
    test(`editor fieldset resists host borders in ${theme} theme at ${width}px`, async ({
      page,
      mock,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(value => localStorage.setItem('qrr-mock-theme', value), theme);
      const item = await mock.item('Network cable');
      for (const route of ['create', 'create?bulk=assigned', `edit/${item.code}`]) {
        await page.goto('/#/' + route);
        const fieldset = page.locator('qrr-editor fieldset');
        await expect(fieldset).toBeVisible();
        // Load after component styles to exercise the host theme's cascade priority.
        await page.addStyleTag({
          content: 'fieldset { border: 2px solid red !important; }',
        });
        // Native host fieldsets must still retain the theme's border.
        await page.evaluate(() => {
          const native = document.createElement('fieldset');
          native.id = 'native-fieldset';
          document.body.append(native);
        });
        await expect(page.locator('#native-fieldset')).toHaveCSS('border-top-width', '2px');
        for (const side of ['top', 'right', 'bottom', 'left']) {
          await expect(fieldset).toHaveCSS(`border-${side}-width`, '0px');
        }
        await expect(fieldset).toHaveCSS('padding', '0px');
        const box = (await fieldset.boundingBox())!;
        expect(box.width).toBeGreaterThan(0);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        await page.locator('#native-fieldset').evaluate(element => element.remove());
      }
    });
  }
}
