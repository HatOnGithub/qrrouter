import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SharedModule } from '@shared/shared.module';
import { ScannerComponent } from '@shared/scanner/scanner.component';
import { LookupComponent } from '@shared/lookup/lookup.component';
import { LocationFieldsComponent } from '@shared/location-fields/location-fields.component';
import { InventoryService } from '@services/inventory.service';
import { ItemType } from '@core/models/inventory';

@Component({
  selector: 'qrr-editor',
  standalone: true,
  imports: [SharedModule, ScannerComponent, LookupComponent, LocationFieldsComponent],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.css',
})
export class EditorComponent {
  protected api = inject(InventoryService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected editing = this.route.snapshot.routeConfig?.path === 'edit/:code';
  protected registering = this.route.snapshot.routeConfig?.path === 'register';
  protected code = this.route.snapshot.paramMap.get('code') || '';
  protected codes = signal<string[]>(
    this.route.snapshot.queryParamMap.get('code')
      ? [this.route.snapshot.queryParamMap.get('code')!]
      : []
  );
  protected thumbnail = '';
  protected busy = signal(false);
  protected error = signal('');
  protected notice = signal('');
  protected count = 1;
  protected model: {
    type: ItemType;
    label: string;
    product_id: number;
    warehouse_id: number;
    qty: number | null;
    serial: string;
    native_batch: string;
    details: string;
    levels: Record<string, string | number>;
    keep_legacy: boolean;
  } = {
    type: 'generic',
    label: '',
    product_id: 0,
    warehouse_id: 0,
    qty: 1,
    serial: '',
    native_batch: '',
    details: '',
    levels: {},
    keep_legacy: false,
  };
  protected initialLevels: Record<string, string | number> = {};
  protected original = this.editing ? this.api.context()!.state.items[this.code] : undefined;

  constructor() {
    const mode = this.route.snapshot.queryParamMap.get('mode');
    if (this.registering && mode) {
      this.model.type = mode === 'unique' ? 'tracked' : mode === 'box' ? 'box' : 'generic';
      this.model.qty = this.model.type === 'box' ? null : 1;
    }
    const source =
      this.original ||
      this.api.context()!.state.items[this.route.snapshot.queryParamMap.get('copy') || ''];
    if (source) {
      this.model = {
        type: source.type,
        label: source.label,
        product_id: source.product_id,
        warehouse_id: source.warehouse_id,
        qty: source.qty,
        serial: this.editing ? source.serial : '',
        native_batch: this.editing ? source.native_batch : '',
        details: this.editing ? source.details : '',
        levels: { ...source.bin_values },
        keep_legacy: this.editing && !Object.keys(source.bin_values || {}).length && !!source.bin,
      };
      if (!this.editing && source.type === 'box') this.model.qty = null;
      this.initialLevels = { ...source.bin_values };
    }
  }

  protected typeChanged(type: ItemType): void {
    this.model.type = type;
    if (type !== 'generic' && this.codes().length > 1) this.codes.set([]);
    this.thumbnail = '';
    this.model.qty = type === 'box' ? null : type === 'unassigned' ? 0 : 1;
    if (type !== 'tracked') {
      this.model.serial = '';
      this.model.native_batch = '';
      this.model.details = '';
    }
  }

  protected warehouseChanged(id: number): void {
    this.model.warehouse_id = id;
    this.model.levels = {};
    this.initialLevels = {};
    this.model.keep_legacy = false;
  }

  protected codesChanged(codes: string[]): void {
    this.thumbnail = '';
    this.codes.set(codes);
  }

  protected async save(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      if (this.editing && !this.original) throw new Error('Item not found');
      const payload =
        this.model.type === 'unassigned'
          ? {
              type: 'unassigned',
              code: this.code,
              count: this.count,
              product_id: 0,
              warehouse_id: 0,
              qty: 0,
              label: '',
              levels: {},
            }
          : {
              ...this.model,
              count: this.count,
              code: this.code,
              codes: this.codes(),
              thumbnail: this.thumbnail,
            };
      if (this.registering) {
        const result = await this.api.command<{ codes: string[]; warning: string }>(
          'register',
          payload
        );
        this.notice.set(
          `${result.codes.length} ${'registered'}${result.warning ? ' · ' + result.warning : ''}`
        );
        this.codes.set([]);
        await this.api.refresh();
        if (result.codes.length === 1 && !result.warning)
          await this.router.navigate(['/items', result.codes[0]]);
      } else if (!this.editing && (this.count > 1 || this.model.type === 'unassigned')) {
        const batch = await this.api.command<string>('bulk', payload);
        await this.api.refresh();
        await this.router.navigate(['/labels'], { queryParams: { batch } });
      } else {
        const code = this.editing ? this.code : await this.api.command<string>('create', payload);
        if (this.editing) await this.api.command('update', payload);
        await this.api.refresh();
        await this.router.navigate(['/items', code]);
      }
    } catch (error) {
      this.error.set(this.api.message(error));
    } finally {
      this.busy.set(false);
    }
  }
}
