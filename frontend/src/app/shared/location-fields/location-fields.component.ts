import {
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { SharedModule } from '@shared/shared.module';
import { Level } from '@core/models/inventory';
import { InventoryService } from '@services/inventory.service';

@Component({
  selector: 'qrr-location-fields',
  standalone: true,
  imports: [SharedModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './location-fields.component.html',
})
export class LocationFieldsComponent {
  private api = inject(InventoryService);
  readonly warehouse = input(0);
  readonly initial = input<Record<string, string | number>>({});
  readonly disabled = input(false);
  readonly selected = output<Record<string, string | number>>();
  protected levels = signal<Level[]>([]);
  protected error = signal('');
  protected loading = signal(false);
  protected values: Record<string, string | number> = {};
  private sequence = 0;

  constructor() {
    effect(() => {
      const wid = this.warehouse();
      this.values = { ...this.initial() };
      void this.load(wid);
    });
  }

  private async load(wid: number): Promise<void> {
    const request = ++this.sequence;
    this.levels.set([]);
    this.error.set('');
    this.loading.set(false);
    if (!wid || this.api.context()?.permissions.locations === false) return;
    this.loading.set(true);
    try {
      const levels = await this.api.levels(wid);
      if (request === this.sequence) this.levels.set(levels);
    } catch (error) {
      if (request === this.sequence) this.error.set(this.api.message(error));
    } finally {
      if (request === this.sequence) this.loading.set(false);
    }
  }

  protected change(id: number, value: string | number): void {
    this.values = { ...this.values, [id]: value };
    this.selected.emit(this.values);
  }

  protected value(id: number): string | number {
    return this.values[id] ?? '';
  }
}
