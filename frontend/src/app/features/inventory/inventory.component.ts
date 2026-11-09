import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { InventoryService } from '@services/inventory.service';
import { SharedModule } from '@shared/shared.module';
import { Item } from '@core/models/inventory';
import { ConsumptionService } from '@services/consumption.service';

@Component({
  selector: 'qrr-inventory',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './inventory.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './inventory.component.css',
})
export class InventoryComponent {
  protected readonly statusClasses: Record<string, string> = {
    Pending: 'badge-warning',
    'On loan': 'badge-info',
    Consumed: 'badge-dark',
    Unassigned: 'badge-secondary',
    'In stock': 'badge-success',
  };
  protected api = inject(InventoryService);
  protected consumption = inject(ConsumptionService);
  protected loans = inject(ActivatedRoute).snapshot.routeConfig?.path === 'loans';
  protected query = signal('');
  protected warehouse = signal(0);
  protected type = signal('');
  protected rows = computed(() =>
    this.api
      .items()
      .filter(
        item =>
          (!this.loans || !!item.checkout) &&
          (!this.warehouse() || item.warehouse_id === this.warehouse()) &&
          (!this.type() || item.type === this.type()) &&
          `${item.code} ${item.label} ${item.serial} ${item.bin} ${this.api.context()?.products[item.product_id]?.ref || ''}`
            .toLowerCase()
            .includes(this.query().toLowerCase())
      )
      .sort((a, b) =>
        (a.label || a.code).localeCompare(b.label || b.code, undefined, { numeric: true })
      )
  );
  protected stats = computed(() => ({
    labels: this.api.items().length,
    unassigned: this.api.items().filter(i => i.type === 'unassigned').length,
    pending: this.api.items().filter(i => i.pending_handoff || i.pending_operation).length,
    loans: this.api.items().filter(i => i.checkout).length,
  }));

  protected status(item: Item): string {
    return item.pending_handoff || item.pending_operation
      ? 'Pending'
      : item.checkout
        ? 'On loan'
        : item.status === 'consumed'
          ? 'Consumed'
          : item.type === 'unassigned'
            ? 'Unassigned'
            : 'In stock';
  }
}
