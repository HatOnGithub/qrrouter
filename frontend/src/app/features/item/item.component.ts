import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SharedModule } from '@shared/shared.module';
import { InventoryService } from '@services/inventory.service';
import { available } from '@core/models/inventory';

@Component({
  selector: 'qrr-item',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './item.component.html',
  styleUrl: './item.component.css',
})
export class ItemComponent {
  protected api = inject(InventoryService);
  private route = inject(ActivatedRoute);
  protected code = signal(this.route.snapshot.paramMap.get('code') || '');
  protected item = computed(() => this.api.context()?.state.items[this.code()]);
  protected available = available;
  protected busy = signal(false);
  protected error = signal('');
  protected notice = signal('');

  constructor() {
    this.route.paramMap.subscribe(params => {
      this.code.set(params.get('code') || '');
      this.error.set('');
      this.notice.set('');
    });
  }

  protected async reconcile(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.notice.set(await this.api.command<string>('reconcile', { code: this.code() }));
      await this.api.refresh();
    } catch (error) {
      this.error.set(this.api.message(error));
    } finally {
      this.busy.set(false);
    }
  }
}
