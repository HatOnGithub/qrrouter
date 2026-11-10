import { Component, DestroyRef, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SharedModule } from '@shared/shared.module';
import { LookupComponent } from '@shared/lookup/lookup.component';
import { LocationFieldsComponent } from '@shared/location-fields/location-fields.component';
import { InventoryService } from '@services/inventory.service';
import { ItemType } from '@core/models/inventory';
import { faArrowLeft, faFloppyDisk, faXmark } from '@fortawesome/free-solid-svg-icons';

@Component({
  selector: 'qrr-editor',
  standalone: true,
  imports: [SharedModule, LookupComponent, LocationFieldsComponent],
  templateUrl: './editor.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './editor.component.css',
})
export class EditorComponent {
  protected readonly icons = { back: faArrowLeft, save: faFloppyDisk, cancel: faXmark };
  protected api = inject(InventoryService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected editing = this.route.snapshot.routeConfig?.path === 'edit/:code';
  protected registering = this.route.snapshot.routeConfig?.path === 'register/details';
  protected bulkAssigned =
    this.route.snapshot.routeConfig?.path === 'create' &&
    this.route.snapshot.queryParamMap.get('bulk') === 'assigned';
  protected code = this.route.snapshot.paramMap.get('code') || '';
  protected codes = signal<string[]>(
    this.route.snapshot.queryParamMap.get('codes')
      ? this.route.snapshot.queryParamMap.get('codes')!.split(',').filter(Boolean)
      : this.route.snapshot.queryParamMap.get('code')
        ? [this.route.snapshot.queryParamMap.get('code')!]
        : []
  );
  protected thumbnail = '';
  protected busy = signal(false);
  protected error = signal('');
  protected notice = signal('');
  protected serialWarning = signal('');
  private serialRequest = 0;
  private serialTimer?: ReturnType<typeof setTimeout>;
  protected count = 1;
  protected bulkLabels = '';
  protected individualLabels(): string[] {
    return this.bulkLabels
      .split(/\r?\n/)
      .map(value => value.trim())
      .filter(Boolean);
  }
  protected namedItems(): boolean {
    return this.bulkAssigned && (this.model.type === 'box' || this.model.type === 'tracked');
  }
  protected duplicateLabels(): boolean {
    if (this.model.type === 'tracked' && !this.model.label_as_serial) return false;
    const labels = this.individualLabels().map(value => value.toLowerCase());
    return new Set(labels).size !== labels.length;
  }
  protected textTooLong(): boolean {
    const length = (value: string) => new TextEncoder().encode(value.trim()).length;
    const limit =
      this.model.type === 'box' || (this.model.type === 'tracked' && this.model.label_as_serial)
        ? 100
        : 140;
    const labels = this.namedItems() ? this.individualLabels() : [this.model.label];
    return (
      this.model.type !== 'unassigned' &&
      (labels.some(label => length(label) > limit) ||
        (this.model.type === 'tracked' &&
          !this.model.label_as_serial &&
          length(this.model.serial) > 100))
    );
  }
  protected model: {
    type: ItemType;
    label: string;
    product_id: number;
    warehouse_id: number;
    qty: number | null;
    serial: string;
    label_as_serial: boolean;
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
    label_as_serial: false,
    native_batch: '',
    details: '',
    levels: {},
    keep_legacy: false,
  };
  protected initialLevels: Record<string, string | number> = {};
  protected original = this.editing ? this.api.context()!.state.items[this.code] : undefined;

  constructor() {
    if (this.bulkAssigned) this.count = 20;
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.serialTimer);
      ++this.serialRequest;
    });
    this.thumbnail = history.state?.thumbnail || '';
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
        label_as_serial: false,
        native_batch: this.editing ? source.native_batch : '',
        details: this.editing ? source.details : '',
        levels: { ...source.bin_values },
        keep_legacy: this.editing && !Object.keys(source.bin_values || {}).length && !!source.bin,
      };
      if (!this.editing && source.type === 'box') this.model.qty = null;
      this.initialLevels = { ...source.bin_values };
    }
    if (this.registering && history.state?.draft) {
      this.model = { ...history.state.draft };
      this.initialLevels = { ...this.model.levels };
    }
  }

  protected changeSelection(): void {
    void this.router.navigate(['/register'], {
      queryParams: {
        codes: this.codes().join(','),
        mode:
          this.model.type === 'tracked' ? 'unique' : this.model.type === 'box' ? 'box' : 'generic',
        input: this.route.snapshot.queryParamMap.get('input') || 'camera',
      },
      state: { thumbnail: this.thumbnail, draft: this.model },
    });
  }

  protected typeChanged(type: ItemType): void {
    this.model.type = type;
    if (!this.bulkAssigned && (type === 'tracked' || type === 'box')) this.count = 1;
    if (type !== 'generic' && this.codes().length > 1) this.codes.set([]);
    this.thumbnail = '';
    this.model.qty = type === 'box' ? null : type === 'unassigned' ? 0 : 1;
    if (type !== 'tracked') {
      this.model.serial = '';
      this.model.label_as_serial = false;
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

  protected checkSerial(): void {
    clearTimeout(this.serialTimer);
    const request = ++this.serialRequest;
    this.serialWarning.set('');
    const serial = (this.model.label_as_serial ? this.model.label : this.model.serial).trim();
    const product = this.model.product_id;
    if (
      !serial ||
      this.bulkAssigned ||
      !product ||
      (this.editing && this.original?.product_lot_id) ||
      this.model.type !== 'tracked'
    )
      return;
    this.serialTimer = setTimeout(async () => {
      try {
        const result = await this.api.read<{ exists: boolean; associated: boolean }>(
          'serial-check',
          {
            product_id: product,
            serial,
          }
        );
        if (request === this.serialRequest)
          this.serialWarning.set(
            result.associated
              ? 'This serial number is already associated with a QR item.'
              : result.exists
                ? 'This serial number already exists in Dolibarr and can be assigned without adding stock.'
                : ''
          );
      } catch (error) {
        if (request === this.serialRequest) this.serialWarning.set(this.api.message(error));
      }
    }, 300);
  }

  protected async save(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      if (this.bulkAssigned && (!this.model.product_id || !this.model.warehouse_id))
        throw new Error('Choose a product and warehouse for the assigned batch.');
      if (this.textTooLong())
        throw new Error(
          'Label text exceeds the size limit: 140 UTF-8 bytes for item names, 100 for serial numbers and box names.'
        );
      if (this.namedItems() && this.duplicateLabels())
        throw new Error(
          this.model.type === 'box'
            ? 'Each box name must be unique.'
            : 'Each label must be unique when used as a serial number.'
        );
      const count = this.namedItems() ? this.individualLabels().length : this.count;
      if (this.editing && !this.original) throw new Error('Item not found');
      const payload =
        this.model.type === 'unassigned'
          ? {
              type: 'unassigned',
              code: this.code,
              count,
              product_id: 0,
              warehouse_id: 0,
              qty: 0,
              label: '',
              levels: {},
            }
          : {
              ...this.model,
              count,
              labels: this.namedItems() ? this.individualLabels() : [],
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
      } else if (
        !this.editing &&
        (this.bulkAssigned || this.count > 1 || this.model.type === 'unassigned')
      ) {
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
      await this.api.refresh();
    } finally {
      this.busy.set(false);
    }
  }
}
