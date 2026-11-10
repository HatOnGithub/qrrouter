import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { SharedModule } from '@shared/shared.module';
import { InventoryService } from '@services/inventory.service';
import { faFloppyDisk } from '@fortawesome/free-solid-svg-icons';

@Component({
  selector: 'qrr-people',
  standalone: true,
  imports: [SharedModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './people.component.html',
})
export class PeopleComponent {
  protected readonly saveIcon = faFloppyDisk;
  protected api = inject(InventoryService);
  protected person = 0;
  protected warehouse = 0;
  protected busy = signal(false);
  protected error = signal('');
  protected notice = signal('');

  protected async save(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await this.api.command('mapping', { user_id: this.person, warehouse_id: this.warehouse });
      this.notice.set('Personal warehouse mapping saved');
      await this.api.refresh();
    } catch (error) {
      this.error.set(this.api.message(error));
    } finally {
      this.busy.set(false);
    }
  }
}
