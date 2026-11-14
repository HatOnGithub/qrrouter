import {
  Component,
  computed,
  inject,
  OnInit,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SharedModule } from '@shared/shared.module';
import { InventoryService } from '@services/inventory.service';
import { PhysicalBin, OperationResult } from '@core/models/inventory';
import { CaptureComponent } from '@shared/scanner/capture.component';
import { LocationFieldsComponent } from '@shared/location-fields/location-fields.component';
import { DestinationComponent } from '@shared/location-fields/destination.component';

/** Physical-bin membership UI; whole-bin moves use fixed server intent and resumable member results. */
@Component({
  selector: 'qrr-bins',
  standalone: true,
  imports: [SharedModule, CaptureComponent, LocationFieldsComponent, DestinationComponent],
  templateUrl: './bins.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class BinsComponent implements OnInit {
  protected api = inject(InventoryService);
  private route = inject(ActivatedRoute);
  protected bins = signal<PhysicalBin[]>([]);
  protected id = signal('');
  protected selected = computed(() => this.bins().find(bin => bin.id === this.id()));
  protected busy = signal(false);
  protected error = signal('');
  protected notice = signal('');
  protected results = signal<OperationResult[]>([]);
  protected packing = signal(false);
  protected codes = signal<string[]>([]);
  protected name = '';
  protected createWarehouse = 0;
  protected createLevels: Record<string, string | number> = {};
  protected warehouse = 0;
  protected levels: Record<string, string | number> = {};
  protected initial: Record<string, string | number> = {};
  protected resolving = signal(false);
  ngOnInit(): void {
    void this.load();
  }
  protected validatePack = (code: string): string => {
    const item = this.api.context()!.state.items[code];
    const bin = this.selected();
    if (!item || item.type === 'unassigned') return 'Scan a registered item';
    if (item.pending_operation || item.pending_handoff || item.pending_bin_move)
      return 'Reconcile this item first';
    if (
      bin &&
      item.physical_bin_id !== bin.id &&
      (item.warehouse_id !== bin.warehouse_id || item.bin_key !== bin.bin_key)
    )
      return 'Move the item to the physical bin location before packing';
    return '';
  };
  protected async load(clearError = true): Promise<void> {
    this.busy.set(true);
    if (clearError) this.error.set('');
    try {
      await this.api.refresh();
      const bins = await this.api.read<PhysicalBin[]>('physical-bins');
      this.bins.set(bins);
      const qr = this.route.snapshot.queryParamMap.get('physical_bin');
      const id = this.route.snapshot.queryParamMap.get('bin_id');
      if (!this.id() && id && bins.some(bin => bin.id === id)) this.id.set(id);
      if (!this.id() && qr) {
        const bin = bins.find(bin => bin.qr === qr);
        if (!bin) throw new Error('Physical bin is unavailable');
        this.id.set(bin.id);
      }
    } catch (error) {
      this.error.set(this.api.message(error));
    } finally {
      this.busy.set(false);
    }
  }
  protected async create(): Promise<void> {
    await this.run(async () => {
      const bin = await this.api.command<PhysicalBin>('physical-bin-create', {
        label: this.name,
        warehouse_id: this.createWarehouse,
        levels: this.createLevels,
      });
      this.id.set(bin.id);
      this.name = '';
      this.notice.set('Physical bin created');
    });
  }
  protected async assign(remove: boolean): Promise<void> {
    await this.run(async () => {
      await this.api.command('physical-bin-assign', {
        bin_id: this.id(),
        codes: this.codes(),
        remove,
      });
      this.codes.set([]);
      this.packing.set(false);
      this.notice.set('Physical bin contents updated');
    });
  }
  protected async move(): Promise<void> {
    await this.run(async () => {
      const result = await this.api.command<{ complete: boolean; results: OperationResult[] }>(
        'physical-bin-move',
        {
          bin_id: this.id(),
          warehouse_id: this.warehouse,
          levels: this.levels,
        }
      );
      this.results.set(result.results);
      this.notice.set(
        result.complete
          ? 'Physical bin and contents moved'
          : 'Move unfinished. Reconcile failed items, then resume the bin move.'
      );
    });
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    this.results.set([]);
    try {
      await action();
    } catch (error) {
      this.error.set(this.api.message(error));
    } finally {
      this.busy.set(false);
      await this.load(false);
    }
  }
}
