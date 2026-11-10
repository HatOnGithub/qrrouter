import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SharedModule } from '@shared/shared.module';
import { InventoryService } from '@services/inventory.service';
import { available } from '@core/models/inventory';
import { ConsumptionService } from '@services/consumption.service';
import {
  faArrowRightFromBracket,
  faArrowRightToBracket,
  faArrowRotateLeft,
  faArrowsRotate,
  faArrowsUpDownLeftRight,
  faClipboardCheck,
  faCopy,
  faMinus,
  faPen,
  faPlus,
  faPrint,
  faQrcode,
  faRightLeft,
} from '@fortawesome/free-solid-svg-icons';

@Component({
  selector: 'qrr-item',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './item.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './item.component.css',
})
export class ItemComponent {
  protected readonly icons = {
    checkout: faArrowRightFromBracket,
    checkin: faArrowRightToBracket,
    return: faArrowRotateLeft,
    reconcile: faArrowsRotate,
    move: faArrowsUpDownLeftRight,
    correct: faClipboardCheck,
    copy: faCopy,
    consume: faMinus,
    edit: faPen,
    register: faPlus,
    print: faPrint,
    scan: faQrcode,
    transfer: faRightLeft,
  };
  protected api = inject(InventoryService);
  protected consumption = inject(ConsumptionService);
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
