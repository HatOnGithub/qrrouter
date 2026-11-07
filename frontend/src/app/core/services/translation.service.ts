import { Injectable, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { InventoryService } from './inventory.service';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private inventory = inject(InventoryService);
  private entityDecoder = inject(DOCUMENT).createElement('textarea');
  private decodedText = new Map<string, string>();

  text(value: string): string {
    const source = this.plainText(value);
    const translations = this.inventory.context()?.translations;
    return this.plainText(translations?.[value] || translations?.[source] || source);
  }

  private plainText(value: string): string {
    if (!/&(?:#(?:x[\da-f]+|\d+)|[a-z][a-z\d]+);/i.test(value)) return value;
    const cached = this.decodedText.get(value);
    if (cached !== undefined) return cached;

    let decoded = value;
    for (let pass = 0; pass < 4; pass++) {
      const next = decoded.replace(/&(?:#(?:x[\da-f]+|\d+)|[a-z][a-z\d]+);/gi, entity => {
        // Parse only a single character reference, never the surrounding text or HTML.
        this.entityDecoder.innerHTML = entity;
        return this.entityDecoder.value;
      });
      if (next === decoded) break;
      decoded = next;
    }

    if (this.decodedText.size >= 512) this.decodedText.clear();
    this.decodedText.set(value, decoded);
    return decoded;
  }
}
