import { Injectable, inject } from '@angular/core';
import { InventoryService } from './inventory.service';

@Injectable({ providedIn: 'root' })
export class NativeLinksService {
  private inventory = inject(InventoryService);
  private readonly pages: Record<string, string> = {
    product: 'product/card.php',
    warehouse: 'product/stock/card.php',
    user: 'user/card.php',
    lot: 'product/stock/productlot_card.php',
    salesorder: 'commande/card.php',
    purchaseorder: 'fourn/commande/card.php',
    production: 'mrp/mo_card.php',
    shipment: 'expedition/card.php',
  };

  link(type: string, id: string | number | null | undefined): string | null {
    const page = this.pages[type];
    const numeric = Number(id);
    if (!page || !Number.isSafeInteger(numeric) || numeric <= 0) return null;
    const url = new URL(this.inventory.link('../../' + page, { id: numeric }), document.baseURI);
    return url.pathname + url.search;
  }
}
