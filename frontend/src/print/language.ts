export const printLanguages = [
  { id: 'en_US', name: 'English' },
  { id: 'nl_NL', name: 'Nederlands' },
  { id: 'fr_FR', name: 'Français' },
];

export function languageSelect(locale: string, caption: string): HTMLLabelElement {
  const label = document.createElement('label');
  label.textContent = caption + ' ';
  const select = document.createElement('select');
  select.name = 'lang';
  select.setAttribute('aria-label', caption);
  for (const language of printLanguages) {
    const option = document.createElement('option');
    option.value = language.id;
    option.textContent = language.name;
    option.selected = language.id === locale;
    select.append(option);
  }
  label.append(select);
  return label;
}

// Location reports use the same selector as the standalone label renderer.
const bootstrap = document.getElementById('qrr-print-language-data');
if (bootstrap) {
  const data: {
    locale: string;
    selection: Record<string, string | number>;
    translations: Record<string, string>;
  } = JSON.parse(bootstrap.textContent!);
  document.documentElement.lang = data.locale.replace('_', '-');
  const form = document.createElement('form');
  form.method = 'get';
  form.append(
    languageSelect(data.locale, data.translations['Output language'] || 'Output language')
  );
  for (const [key, value] of Object.entries(data.selection)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = String(value);
    form.append(input);
  }
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = data.translations['Apply language'] || 'Apply language';
  form.append(button);
  document.querySelector('.qrr-print-tool')?.append(form);
}
