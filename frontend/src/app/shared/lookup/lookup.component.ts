import { Component, input, output, signal, inject } from '@angular/core';
import { SharedModule } from '@shared/shared.module';
import { InventoryService } from '@services/inventory.service';
import { Lookup } from '@core/models/inventory';

@Component({
  selector: 'qrr-lookup',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './lookup.component.html',
  styleUrl: './lookup.component.css',
})
export class LookupComponent {
  private api = inject(InventoryService);
  readonly resource = input('products');
  readonly type = input('');
  readonly label = input('Product');
  readonly disabled = input(false);
  readonly selected = output<Lookup | null>();
  readonly rows = signal<Lookup[]>([]);
  readonly open = signal(false);
  readonly loading = signal(false);
  readonly selectedText = signal('');
  readonly error = signal('');
  protected query = '';
  private sequence = 0;

  async search(query: string): Promise<void> {
    this.query = query;
    this.selectedText.set('');
    this.selected.emit(null);
    this.open.set(true);
    const request = ++this.sequence;
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
    this.selected.emit(row);
    this.open.set(false);
  }

  clear(): void {
    ++this.sequence;
    this.query = '';
    this.selectedText.set('');
    this.selected.emit(null);
    this.open.set(false);
  }
}
