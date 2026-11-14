import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { SharedModule } from '@shared/shared.module';
import { CaptureComponent } from '@shared/scanner/capture.component';
import { InventoryService } from '@services/inventory.service';
import { LocationScan } from '@core/models/inventory';

/** Resolve storage-location scans server-side and emit only the validated current destination. */
@Component({
  selector: 'qrr-destination',
  standalone: true,
  imports: [SharedModule, CaptureComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <button
      type="button"
      mat-stroked-button
      (click)="scanning.set(!scanning())"
      [disabled]="busy()"
    >
      {{ 'Scan destination bin' | t }}
    </button>
    @if (scanning()) {
      <qrr-capture content="locations" [multiple]="false" (changed)="scan($event)" />
    }
    @if (error()) {
      <p class="alert" role="alert">{{ error() | t }}</p>
    }
    @if (active(); as location) {
      <qrr-card [title]="('Destination contents' | t) + ': ' + location.label">
        <p>
          {{ api.context()!.warehouses[location.warehouse_id]?.ref }} · {{ 'Updated' | t }}:
          {{ location.updated_at | date: 'short' }}
        </p>
        @if (location.pending_count) {
          <p class="alert">
            {{ location.pending_count }}
            {{ 'items have pending movements and are excluded from these totals.' | t }}
          </p>
        }
        <button type="button" mat-button (click)="scan([payload])" [disabled]="busy()">
          {{ 'Refresh contents' | t }}
        </button>
        <table>
          <thead>
            <tr>
              <th>{{ 'Item / product' | t }}</th>
              <th>{{ 'Quantity' | t }}</th>
            </tr>
          </thead>
          <tbody>
            @for (item of location.summary.tracked; track item.code) {
              <tr>
                <td>
                  <a [routerLink]="['/items', item.code]">{{ api.itemName(item) }}</a>
                  <small>{{ item.serial }}</small>
                </td>
                <td>1</td>
              </tr>
            }
            @for (row of location.summary.totals; track row.product_id) {
              <tr>
                <td>{{ row.product.label || row.product.ref }}</td>
                <td>
                  {{ row.generic + row.box }}
                  @if (row.unknown_boxes) {
                    + {{ row.unknown_boxes }} {{ 'uncounted containers' | t }}
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
        @if (!location.summary.tracked.length && !location.summary.totals.length) {
          <p>{{ 'No QR-tracked contents at this location' | t }}</p>
        }
      </qrr-card>
    }
  `,
})
export class DestinationComponent {
  protected api = inject(InventoryService);
  readonly selected = output<LocationScan>();
  readonly warehouse = input(0);
  readonly values = input<Record<string, string | number> | null>(null);
  // Hide scanned contents once manual edits diverge from the resolved warehouse/level values;
  // otherwise an old report could appear to describe the newly selected destination.
  protected active = computed(() => {
    const location = this.location();
    const values = this.values();
    if (!location) return null;
    if (values === null) return location;
    const entries = (data: Record<string, string | number>) =>
      JSON.stringify(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
    return this.warehouse() === location.warehouse_id &&
      entries(values) === entries(location.levels)
      ? location
      : null;
  });
  readonly resolving = output<boolean>();
  protected scanning = signal(false);
  protected busy = signal(false);
  protected error = signal('');
  protected location = signal<LocationScan | null>(null);
  protected payload = '';
  protected async scan(codes: string[]): Promise<void> {
    if (!codes.length || this.busy()) return;
    this.scanning.set(false);
    this.busy.set(true);
    this.resolving.emit(true);
    this.error.set('');
    try {
      const location = await this.api.read<LocationScan>('location-qr', { payload: codes[0] });
      this.payload = codes[0];
      this.location.set(location);
      this.selected.emit(location);
    } catch (error) {
      this.error.set(this.api.message(error));
    } finally {
      this.busy.set(false);
      this.resolving.emit(false);
    }
  }
}
