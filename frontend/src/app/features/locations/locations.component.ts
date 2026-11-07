import { Component, inject, signal } from '@angular/core';
import { SharedModule } from '@shared/shared.module';
import { InventoryService } from '@services/inventory.service';
import { BinSummary, Level } from '@core/models/inventory';

interface LocationData {
  bins: string[];
  summary: BinSummary;
  qr: Record<string, { known: number; unknown: number }>;
  native: Record<string, Record<string, number>>;
}
@Component({
  selector: 'qrr-locations',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './locations.component.html',
})
export class LocationsComponent {
  protected api = inject(InventoryService);
  protected warehouse = 0;
  protected bin = '';
  protected data = signal<LocationData | null>(null);
  protected levels = signal<Level[]>([]);
  protected error = signal('');
  protected notice = signal('');
  protected busy = signal(false);
  protected show: Record<string, boolean> = {};
  protected separator: Record<string, string> = {};
  protected showWarehouse = false;
  private sequence = 0;

  protected async load(newWarehouse = false): Promise<void> {
    const request = ++this.sequence;
    this.error.set('');
    this.notice.set('');
    this.data.set(null);
    if (!this.warehouse) return;
    if (newWarehouse) {
      this.bin = '';
      this.levels.set([]);
    }
    this.busy.set(true);
    try {
      const data = await this.api.read<LocationData>('locations', {
        warehouse_id: this.warehouse,
        bin: this.bin,
      });
      if (request !== this.sequence) return;
      this.data.set(data);
      if (newWarehouse && this.api.context()!.permissions.manage) {
        const levels = await this.api.levels(this.warehouse);
        if (request !== this.sequence) return;
        this.levels.set(levels);
        const prefs = this.api.context()!.state.binloc_label_settings?.[this.warehouse];
        this.show = {};
        this.separator = {};
        this.showWarehouse = prefs?.show_warehouse || false;
        for (const level of levels) {
          this.show[level.id] = prefs ? !!prefs.show[level.id] : true;
          this.separator[level.id] = prefs?.separator[level.id] || '-';
        }
      }
    } catch (error) {
      if (request === this.sequence) this.error.set(this.api.message(error));
    } finally {
      if (request === this.sequence) this.busy.set(false);
    }
  }

  protected async saveFormat(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.command('label-settings', {
        warehouse_id: this.warehouse,
        format: {
          show: Object.fromEntries(
            Object.entries(this.show)
              .filter(([, value]) => value)
              .map(([key]) => [key, 1])
          ),
          separator: this.separator,
          show_warehouse: this.showWarehouse,
        },
      });
      this.notice.set('Local label format saved');
      await this.api.refresh();
    } catch (error) {
      this.error.set(this.api.message(error));
    } finally {
      this.busy.set(false);
    }
  }
}
