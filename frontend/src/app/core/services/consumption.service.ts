import { Injectable, inject } from '@angular/core';
import { ConsumptionEntry, Item } from '@core/models/inventory';
import { InventoryService } from './inventory.service';
import { TranslationService } from './translation.service';

/** Resolve consumption destinations only through the gateway's authorized reference catalog. */
@Injectable({ providedIn: 'root' })
export class ConsumptionService {
  private inventory = inject(InventoryService);
  private translations = inject(TranslationService);

  latest(item: Item): ConsumptionEntry | undefined {
    const history = item.consumption_log || [];
    for (let index = history.length - 1; index >= 0; index--) {
      if (history[index].kind === 'consume') return history[index];
    }
    return undefined;
  }

  reference(entry?: ConsumptionEntry) {
    if (!entry?.reference_type || !entry.reference_id) return undefined;
    return this.inventory.context()?.consumption_references?.[
      `${entry.reference_type}:${entry.reference_id}`
    ];
  }

  destination(entry?: ConsumptionEntry): string {
    const reference = this.reference(entry);
    if (reference) return reference.ref;
    return entry?.reason?.trim() || this.translations.text('Not recorded');
  }
}
