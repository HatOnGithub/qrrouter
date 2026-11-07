import { Injectable, inject } from '@angular/core';
import { InventoryService } from './inventory.service';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private inventory = inject(InventoryService);

  text(value: string): string {
    return this.inventory.context()?.translations[value] || value;
  }
}
