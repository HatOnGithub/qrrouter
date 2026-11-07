import { Component, computed, inject, signal } from '@angular/core';
import { SharedModule } from '@shared/shared.module';
import { InventoryService } from '@services/inventory.service';

@Component({
  selector: 'qrr-labels',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './labels.component.html',
})
export class LabelsComponent {
  protected api = inject(InventoryService);
  protected count = 20;
  protected busy = signal(false);
  protected error = signal('');
  protected batches = computed(() =>
    Object.entries(this.api.context()!.state.batches)
      .map(([id, batch]) => ({
        id,
        batch,
        unassigned: batch.codes.filter(
          code => this.api.context()!.state.items[code]?.type === 'unassigned'
        ).length,
      }))
      .sort((a, b) => b.batch.created_at.localeCompare(a.batch.created_at))
  );

  protected async create(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.command('bulk', { type: 'unassigned', count: this.count });
      await this.api.refresh();
    } catch (error) {
      this.error.set(this.api.message(error));
    } finally {
      this.busy.set(false);
    }
  }
}
