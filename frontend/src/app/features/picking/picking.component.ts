import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { SharedModule } from '@shared/shared.module';
import { LookupComponent } from '@shared/lookup/lookup.component';
import { InventoryService } from '@services/inventory.service';
import { PickRow } from '@core/models/inventory';
import { faListCheck, faPrint } from '@fortawesome/free-solid-svg-icons';
import { faSquare } from '@fortawesome/free-regular-svg-icons';

@Component({
  selector: 'qrr-picking',
  standalone: true,
  imports: [SharedModule, LookupComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './picking.component.html',
})
export class PickingComponent {
  protected readonly icons = { preview: faListCheck, print: faPrint, unchecked: faSquare };
  protected api = inject(InventoryService);
  protected warehouse = 0;
  protected order = 0;
  protected orderName = '';
  protected busy = signal(false);
  protected error = signal('');
  protected rows = signal<PickRow[]>([]);

  protected async preview(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.rows.set(
        await this.api.read<PickRow[]>('picking', {
          warehouse_id: this.warehouse,
          order_id: this.order,
        })
      );
    } catch (error) {
      this.rows.set([]);
      this.error.set(this.api.message(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected print(): void {
    window.print();
  }
}
