import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SharedModule } from '@shared/shared.module';
import { ScannerComponent } from '@shared/scanner/scanner.component';
import { LookupComponent } from '@shared/lookup/lookup.component';
import { LocationFieldsComponent } from '@shared/location-fields/location-fields.component';
import { InventoryService } from '@services/inventory.service';
import { Item, OperationResult } from '@core/models/inventory';
import { Subscription, combineLatest } from 'rxjs';

@Component({
  selector: 'qrr-workflow',
  standalone: true,
  imports: [SharedModule, ScannerComponent, LookupComponent, LocationFieldsComponent],
  templateUrl: './workflow.component.html',
  styleUrl: './workflow.component.css',
})
export class WorkflowComponent implements OnDestroy {
  protected api = inject(InventoryService);
  private route = inject(ActivatedRoute);
  protected kind = signal('move');
  protected codes = signal<string[]>([]);
  protected review = signal(false);
  protected busy = signal(false);
  protected error = signal('');
  protected results = signal<OperationResult[]>([]);
  protected selected: Record<string, boolean> = {};
  protected quantities: Record<string, number> = {};
  protected warehouse = 0;
  protected levels: Record<string, string | number> = {};
  protected person = 0;
  protected reason = '';
  protected postStock = true;
  protected referenceType = '';
  protected referenceId = 0;
  protected titles: Record<string, string> = {
    move: 'Move items',
    consume: 'Consume items',
    checkout: 'Check out items',
    checkin: 'Check in items',
    return: 'Return items',
    correct: 'Correct container quantity',
    transfer: 'Transfer contents between containers',
  };
  protected title = computed(() => this.titles[this.kind()] || 'Unknown workflow');
  protected rows = computed(() =>
    this.codes().map(code => ({
      code,
      item: this.api.context()!.state.items[code] as Item | undefined,
    }))
  );
  protected establishing = computed(
    () => this.kind() === 'correct' && this.rows().length === 1 && this.rows()[0].item?.qty === null
  );
  private subscription: Subscription;

  constructor() {
    this.subscription = combineLatest([this.route.paramMap, this.route.queryParamMap]).subscribe(
      ([params, query]) => {
        this.kind.set(params.get('kind') || 'move');
        this.review.set(false);
        this.results.set([]);
        this.error.set('');
        const code = query.get('code');
        this.codes.set(code ? [code] : []);
        this.selected = {};
        this.quantities = {};
        this.warehouse = 0;
        this.levels = {};
        this.person = 0;
        this.reason = '';
        this.postStock = true;
        this.referenceId = 0;
        this.referenceType = '';
        if (!this.api.context()!.permissions.stock) this.postStock = false;
        if (code) this.prepare();
      }
    );
  }

  protected prepare(): void {
    this.error.set('');
    if (!this.codes().length) {
      this.error.set('Scan at least one QR label');
      return;
    }
    if (this.kind() === 'transfer' && this.codes().length !== 2) {
      this.error.set('Scan exactly two containers, source first');
      return;
    }
    for (const { code, item } of this.rows()) {
      this.selected[code] = !!item;
      this.quantities[code] = this.kind() === 'correct' ? item?.qty || 0 : 1;
    }
    this.review.set(true);
  }

  protected async perform(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.results.set([]);
    try {
      const codes = this.codes().filter(code => this.selected[code]);
      if (!codes.length) throw new Error('Select at least one item');
      if (this.kind() === 'transfer') {
        if (codes.length !== 2) throw new Error('Select exactly two containers');
        await this.api.command('box-transfer', {
          from: codes[0],
          to: codes[1],
          quantity: this.quantities[codes[0]],
        });
        this.results.set(
          codes.map(code => ({
            code,
            ok: true,
            message: 'Container contents transferred; native stock unchanged',
          }))
        );
      } else if (this.establishing()) {
        await this.api.command('count', {
          code: codes[0],
          quantity: this.quantities[codes[0]],
          reason: this.reason,
        });
        this.results.set([
          { code: codes[0], ok: true, message: 'QR count established; native stock unchanged' },
        ]);
      } else {
        this.results.set(
          await this.api.command<OperationResult[]>('workflow', {
            kind: this.kind(),
            codes,
            quantities: this.quantities,
            warehouse_id: this.warehouse,
            levels: this.levels,
            person_id: this.person,
            reason: this.reason,
            post_stock: this.postStock,
            reference_type: this.referenceType,
            reference_id: this.referenceId,
          })
        );
      }
      await this.api.refresh();
    } catch (error) {
      this.error.set(this.api.message(error));
      await this.api.refresh();
    } finally {
      this.busy.set(false);
    }
  }

  protected restart(): void {
    this.codes.set([]);
    this.results.set([]);
    this.review.set(false);
    this.error.set('');
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
}
