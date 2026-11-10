const form = document.querySelector('#mock-controls');
const status = document.querySelector('#mock-error');
const button = form.querySelector('button');

async function loadControls() {
  try {
    const response = await fetch('/__mock/state');
    if (!response.ok)
      throw new Error('Cannot reach the mock server. Start with npm run start:mock.');
    const settings = await response.json();
    for (const key of ['scenario', 'locale', 'latency'])
      form.elements.namedItem(key).value = String(settings[key]);
    form.elements.namedItem('theme').value = document.documentElement.dataset.mockTheme;
  } catch (error) {
    status.textContent = error.message;
  }
}
void loadControls();

form.addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = '';
  const values = Object.fromEntries(new FormData(form));
  try {
    const response = await fetch('/__mock/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenario: values.scenario,
        locale: values.locale,
        latency: Number(values.latency),
      }),
    });
    if (!response.ok) throw new Error((await response.json()).message);
    localStorage.setItem('qrr-mock-theme', values.theme);
    location.reload();
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});
