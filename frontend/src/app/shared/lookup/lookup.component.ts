import {
  Component,
  input,
  output,
  signal,
  inject,
  ChangeDetectionStrategy,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { SharedModule } from '@shared/shared.module';
import { InventoryService } from '@services/inventory.service';
import { Lookup } from '@core/models/inventory';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { faXmark } from '@fortawesome/free-solid-svg-icons';

@Component({
  selector: 'qrr-lookup',
  standalone: true,
  imports: [SharedModule, MatAutocompleteModule],
  templateUrl: './lookup.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './lookup.component.css',
})
export class LookupComponent implements OnChanges {
  protected readonly clearIcon = faXmark;
  private api = inject(InventoryService);
  readonly resource = input('products');
  readonly type = input('');
  readonly label = input('Product');
  readonly disabled = input(false);
  readonly selected = output<Lookup | null>();
  readonly rows = signal<Lookup[]>([]);
  readonly loading = signal(false);
  readonly selectedText = signal('');
  protected selectedId = signal(0);
  readonly error = signal('');
  protected query = '';
  private sequence = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (['resource', 'type'].some(key => changes[key] && !changes[key].firstChange)) {
      this.clear();
    }
  }

  protected browse(): void {
    // Material restores input focus after selection; keep that selection intact.
    if (!this.selectedText()) void this.search(this.query);
  }

  async search(query: string): Promise<void> {
    this.query = query;
    this.selectedText.set('');
    this.selectedId.set(0);
    this.selected.emit(null);
    const request = ++this.sequence;
    this.rows.set([]);
    this.loading.set(true);
    this.error.set('');
    try {
      const rows = await this.api.lookup(this.resource(), query, this.type());
      if (request === this.sequence) this.rows.set(rows);
    } catch (error) {
      if (request === this.sequence) this.error.set(this.api.message(error));
    } finally {
      if (request === this.sequence) this.loading.set(false);
    }
  }

  choose(row: Lookup): void {
    ++this.sequence;
    this.query = row.text;
    this.selectedText.set(row.text);
    this.selectedId.set(row.id);
    this.selected.emit(row);
  }

  protected displayRow(value: Lookup | string | null): string {
    return typeof value === 'string' ? value : value?.text || '';
  }

  protected objectType(): string {
    if (this.resource() === 'products') return 'product';
    if (this.resource() === 'orders') return 'salesorder';
    if (this.resource() === 'manufacturing-orders') return 'production';
    return this.resource() === 'references' ? this.type() : '';
  }

  clear(): void {
    ++this.sequence;
    this.query = '';
    this.selectedText.set('');
    this.selectedId.set(0);
    this.selected.emit(null);
    this.rows.set([]);
    this.loading.set(false);
    this.error.set('');
  }
}
