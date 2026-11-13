import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { InventoryService } from '@services/inventory.service';
import { SharedModule } from '@shared/shared.module';
import { Item } from '@core/models/inventory';
import { ConsumptionService } from '@services/consumption.service';
import { downloadCsv, inventoryCsv } from '@features/csv/csv';

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
  protected statusFilter = signal<'active' | 'consumed'>('active');
  protected rows = computed(() =>
    this.api
      .items()
      .filter(
        item =>
          (!this.loans || !!item.checkout) &&
          (!this.warehouse() || item.warehouse_id === this.warehouse()) &&
          (!this.type() || item.type === this.type()) &&
          (item.type !== 'unassigned' || this.type() === 'unassigned') &&
          (this.statusFilter() === 'consumed'
            ? item.status === 'consumed'
            : item.status !== 'consumed') &&
          this.matchesSearch(item)
      )
      .sort((a, b) =>
        this.api.itemName(a).localeCompare(this.api.itemName(b), undefined, { numeric: true })
      )
  );
  // Product metadata is shared by many items; rebuild it only when inventory refreshes.
  private productSearch = computed(() =>
    Object.fromEntries(
      Object.entries(this.api.context()?.products || {}).map(([id, product]) => [
        id,
        [
          product.ref,
          product.label,
          ...(product.tags || []),
          ...Object.entries(product.extrafields || {}).flatMap(([key, field]) => [
            key,
            field.label,
            field.value,
          ]),
        ]
          .join(' ')
          .toLowerCase(),
      ])
    )
  );
  private matchesSearch(item: Item): boolean {
    const query = this.query().trim().toLowerCase();
    if (!query) return true;
    return [
      item.code,
      this.api.itemName(item),
      item.serial,
      item.native_batch,
      item.bin,
      item.details,
      this.productSearch()[item.product_id],
    ]
      .join(' ')
      .toLowerCase()
      .includes(query);
  }
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
  protected exportCsv(): void {
    const context = this.api.context()!;
    downloadCsv(
      'qrrouter-inventory.csv',
      inventoryCsv(this.rows(), context.products, context.warehouses)
    );
  }
}
