import { Injectable, inject } from '@angular/core';
import { OverlayContainer } from '@angular/cdk/overlay';

@Injectable({ providedIn: 'root' })
export class DolibarrThemeService {
  private overlay = inject(OverlayContainer);

  apply(): void {
    const host = document.querySelector<HTMLElement>('qrr-root');
    if (!host) return;
    // Measure native Dolibarr controls. Never change Dolibarr's document-level theme.
    const sample = document.createElement('div');
    sample.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;';
    const button = document.createElement('button');
    button.className = 'butAction';
    const input = document.createElement('input');
    input.className = 'flat';
    sample.append(button, input);
    document.body.append(sample);
    const nativeButton = getComputedStyle(button);
    const nativeInput = getComputedStyle(input);
    const text = getComputedStyle(host).color;
    let surface = '';
    for (
      let ancestor: HTMLElement | null = host.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const background = getComputedStyle(ancestor).backgroundColor;
      if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') {
        surface = background;
        break;
      }
    }
    if (!surface) {
      const background = getComputedStyle(document.documentElement).backgroundColor;
      surface =
        background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent' ? background : 'Canvas';
    }
    const values: Record<string, string> = {
      '--qrr-text': text,
      '--qrr-surface': surface,
      '--qrr-action-bg': nativeButton.backgroundColor,
      '--qrr-action-background': nativeButton.background,
      '--qrr-action-text': nativeButton.color,
      '--qrr-font': getComputedStyle(host).fontFamily,
      '--qrr-font-size': getComputedStyle(host).fontSize,
      '--qrr-input-bg': nativeInput.backgroundColor,
    };
    sample.remove();
    for (const target of [host, this.overlay.getContainerElement()]) {
      target.classList.add('qrr-theme');
      for (const [key, value] of Object.entries(values)) target.style.setProperty(key, value);
    }
  }
}
