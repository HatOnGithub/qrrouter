import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { SharedModule } from '@shared/shared.module';
import { InventoryService } from '@services/inventory.service';
import { CsvImportService, ImportRow } from './csv-import.service';
import {
  CsvRecord,
  downloadCsv,
  inventoryCsv,
  inventoryRecord,
  readRecords,
  recordsCsv,
} from './csv';

@Component({
  selector: 'qrr-csv',
  standalone: true,
  imports: [SharedModule],
  providers: [CsvImportService],
  templateUrl: './csv.component.html',
  styleUrl: './csv.component.css',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class CsvComponent {
  protected readonly actionNames = {
    create: 'Create',
    register: 'Register',
    update: 'Update',
    skip: 'Skip',
  };
  protected readonly statusNames = {
    ready: 'Ready',
    unchanged: 'Unchanged',
    invalid: 'Invalid',
    done: 'Imported',
    failed: 'Failed',
  };
  protected api = inject(InventoryService);
  private transfer = inject(CsvImportService);
  protected rows = signal<ImportRow[]>([]);
  protected busy = signal(false);
  protected error = signal('');
  protected notice = signal('');
  protected attempted = signal(false);
  protected fileName = signal('');
  protected ready = computed(() => this.rows().filter(row => row.status === 'ready').length);
  protected invalid = computed(() => this.rows().some(row => row.status === 'invalid'));
  private records: CsvRecord[] = [];
  private active = true;
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.active = false;
    });
  }
  protected exportAll(): void {
    const context = this.api.context()!;
    downloadCsv(
      'qrrouter-inventory.csv',
      inventoryCsv(this.api.items(), context.products, context.warehouses)
    );
  }
  protected template(): void {
    downloadCsv('qrrouter-template.csv', recordsCsv([]));
  }
  protected async selectFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || this.busy()) return;
    this.rows.set([]);
    this.records = [];
    this.error.set('');
    this.notice.set('');
    this.attempted.set(false);
    this.fileName.set(file.name);
    this.busy.set(true);
    try {
      if (file.size > 1024 * 1024) throw new Error('CSV files must be at most 1 MiB');
      this.records = readRecords(
        new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      );
      this.rows.set(await this.transfer.preview(this.records));
    } catch (error) {
      this.error.set(this.api.message(error));
    } finally {
      this.busy.set(false);
    }
  }
  protected async previewAgain(): Promise<void> {
    if (!this.records.length || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    this.attempted.set(false);
    try {
      this.rows.set(await this.transfer.preview(this.records));
    } catch (error) {
      this.error.set(this.api.message(error));
    } finally {
      this.busy.set(false);
    }
  }
  protected async apply(): Promise<void> {
    if (this.busy() || this.invalid() || this.attempted() || !this.ready()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    this.attempted.set(true);
    try {
      await this.transfer.apply(
        this.rows(),
        () => this.rows.set([...this.rows()]),
        () => this.active
      );
      this.rows.set([...this.rows()]);
      this.notice.set(
        this.rows().some(row => row.status === 'failed' || row.status === 'ready')
          ? 'Import stopped. Review the results and resolve any pending operation before continuing.'
          : 'CSV import completed'
      );
    } catch (error) {
      if (!this.rows().some(row => row.status === 'done' || row.status === 'failed'))
        this.attempted.set(false);
      this.error.set(this.api.message(error));
    } finally {
      this.busy.set(false);
    }
  }
  protected report(): void {
    const context = this.api.context()!;
    downloadCsv(
      'qrrouter-import-results.csv',
      recordsCsv(
        this.rows().map(row => {
          const item = context.state.items[row.code];
          const current = item ? inventoryRecord(item, context.products, context.warehouses) : {};
          return {
            ...current,
            ...(row.status === 'done' || row.status === 'unchanged' ? {} : row.source),
            code: row.code,
            import_status: row.status,
            import_message: row.message,
          };
        })
      )
    );
  }
}
