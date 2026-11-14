import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SharedModule } from '@shared/shared.module';
import { InventoryService } from '@services/inventory.service';
import { BinSummary, Level, LocationScan } from '@core/models/inventory';
import { faFloppyDisk, faPrint } from '@fortawesome/free-solid-svg-icons';
import {
  LocationLevelsEditorComponent,
  LocationLevelChanges,
} from './location-levels-editor.component';

interface LocationData {
  pending_count?: number;
  bins: string[];
  summary: BinSummary;
  qr: Record<string, { known: number; unknown: number }>;
  native: Record<string, Record<string, number>>;
}
@Component({
  selector: 'qrr-locations',
  standalone: true,
  imports: [SharedModule, LocationLevelsEditorComponent],
  templateUrl: './locations.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './locations.component.css',
})
export class LocationsComponent {
  protected readonly icons = { save: faFloppyDisk, print: faPrint };
  protected api = inject(InventoryService);
  protected warehouse = 0;
  protected bin = '';
  protected binSearch = '';
  protected reportLevel = 0;
  protected levelValue = '';
  protected data = signal<LocationData | null>(null);
  protected levels = signal<Level[]>([]);
  protected error = signal('');
  protected notice = signal('');
  protected busy = signal(false);
  protected updated = signal('');
  protected show: Record<string, boolean> = {};
  protected separator: Record<string, string> = {};
  protected showWarehouse = false;

  private sequence = 0;

  protected matchingBins(): string[] {
    const query = this.binSearch.trim().toLocaleLowerCase();
    return (this.data()?.bins || []).filter(bin => bin.toLocaleLowerCase().includes(query));
  }

  protected reportValues(): { value: string; label: string }[] {
    const level = this.levels().find(level => level.id === this.reportLevel);
    if (level?.datatype === 'list' || level?.datatype === 'letter')
      return level.options.map(option => ({ value: String(option.id), label: option.value }));
    const values = Object.values(this.api.context()!.state.items)
      .filter(
        item =>
          item.warehouse_id === this.warehouse &&
          item.type !== 'unassigned' &&
          item.status !== 'consumed' &&
          !item.pending_operation &&
          !item.pending_handoff
      )
      .map(item => String(item.bin_values?.[this.reportLevel] ?? '').trim())
      .filter(Boolean);
    return [...new Set(values)]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map(value => ({ value, label: value }));
  }

  protected selectBin(): void {
    this.reportLevel = 0;
    this.levelValue = '';
    void this.load();
  }

  protected selectLevel(): void {
    this.bin = '';
    this.levelValue = '';
    void this.load();
  }

  constructor() {
    inject(ActivatedRoute)
      .queryParamMap.pipe(takeUntilDestroyed())
      .subscribe(query => {
        if (query.get('location')) {
          void this.openLocation(query.get('location')!);
          return;
        }
        const warehouse = Number(query.get('warehouse_id'));
        if (this.api.context()!.warehouses[warehouse]) {
          this.warehouse = warehouse;
          void this.load(
            true,
            query.get('bin') || '',
            Number(query.get('level_id')),
            query.get('level_value') || ''
          );
        }
      });
  }

  private async openLocation(payload: string): Promise<void> {
    this.busy.set(true);
    try {
      const location = await this.api.read<LocationScan>('location-qr', { payload });
      this.warehouse = location.warehouse_id;
      await this.load(true, location.bin);
    } catch (error) {
      this.error.set(this.api.message(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async load(
    newWarehouse = false,
    initialBin = '',
    levelId = 0,
    levelValue = ''
  ): Promise<void> {
    const request = ++this.sequence;
    this.error.set('');
    this.notice.set('');
    this.data.set(null);
    if (!this.warehouse) return;
    if (newWarehouse) {
      this.bin = initialBin;
      this.binSearch = '';
      this.reportLevel = levelId;
      this.levelValue = levelValue;
      this.levels.set([]);
    }
    this.busy.set(true);
    try {
      const data = await this.api.read<LocationData>('locations', {
        warehouse_id: this.warehouse,
        bin: this.bin,
        level_id: this.reportLevel,
        level_value: this.levelValue,
      });
      if (request !== this.sequence) return;
      this.data.set(data);
      this.updated.set(new Date().toISOString());
      if (newWarehouse) {
        const levels = await this.api.levels(this.warehouse);
        if (request !== this.sequence) return;
        this.levels.set(levels);
        const prefs = this.api.context()!.state.location_label_settings?.[this.warehouse];
        this.show = {};
        this.separator = {};
        this.showWarehouse = prefs?.show_warehouse || false;
        for (const level of levels) {
          this.show[level.id] = prefs ? !!prefs.show[level.id] : true;
          this.separator[level.id] = prefs?.separator?.[level.id] ?? '-';
        }
      }
    } catch (error) {
      if (request === this.sequence) this.error.set(this.api.message(error));
    } finally {
      if (request === this.sequence) this.busy.set(false);
    }
  }

  protected async saveLevels(changes: LocationLevelChanges): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.command('location-configure', {
        warehouse_id: this.warehouse,
        ...changes,
      });
      await this.load(true, this.bin);
      this.notice.set('Location levels saved');
    } catch (error) {
      this.error.set(this.api.message(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async importLocations(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.command('location-import', {});
      await this.api.refresh();
      await this.load(true, this.bin);
      this.notice.set('Locations imported into QR Router');
    } catch (error) {
      this.error.set(this.api.message(error));
    } finally {
      this.busy.set(false);
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
