import {
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DestinationComponent } from '@shared/location-fields/destination.component';
import { physicalBinCode } from '@shared/scanner/codes';
import { SharedModule } from '@shared/shared.module';
import { CaptureComponent } from '@shared/scanner/capture.component';
import { LookupComponent } from '@shared/lookup/lookup.component';
import { LocationFieldsComponent } from '@shared/location-fields/location-fields.component';
import { InventoryService } from '@services/inventory.service';
import { available, Item, OperationResult, PickRow } from '@core/models/inventory';
import { Subscription, combineLatest } from 'rxjs';
import {
  faArrowLeft,
  faArrowRight,
  faCheck,
  faMinus,
  faPlus,
  faRotateRight,
} from '@fortawesome/free-solid-svg-icons';

/**
 * Capture -> review -> submit interaction shared by stock and loan workflows. Client eligibility
 * is feedback only; staging recalculates the plan and pick allowance from current server state.
 */
@Component({
  selector: 'qrr-workflow',
  standalone: true,
  imports: [
    SharedModule,
    CaptureComponent,
    LookupComponent,
    LocationFieldsComponent,
    DestinationComponent,
  ],
  templateUrl: './workflow.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './workflow.component.css',
})
export class WorkflowComponent implements OnDestroy {
  protected readonly icons = {
    back: faArrowLeft,
    review: faArrowRight,
    confirm: faCheck,
    decrease: faMinus,
    increase: faPlus,
    restart: faRotateRight,
  };
  protected api = inject(InventoryService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  protected destinationBusy = signal(false);
  protected destinationInitial: Record<string, string | number> = {};
  protected scanned(codes: string[]): void {
    const bin = codes.find(physicalBinCode);
    if (bin && this.kind() === 'move')
      void this.router.navigate(['/bins'], { queryParams: { physical_bin: bin, move: 1 } });
    else this.codes.set(codes);
  }
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
  protected pickOrder = 0;
  protected pickWarehouse = 0;
  protected pickRows = signal<PickRow[] | null>(null);
  protected pickBusy = signal(false);
  private pickGeneration = 0;
  private routeKey = '';

  protected validateScan = (code: string, codes: string[]): string => {
    if (this.kind() === 'move' && physicalBinCode(code)) return '';
    const item = this.api.context()!.state.items[code];
    if (!item) return 'Unknown QR label';
    if (item.type === 'unassigned') return 'Register this QR label first';
    if (item.pending_operation || item.pending_handoff || item.pending_bin_move)
      return 'Reconcile this item first';
    if (!this.titles[this.kind()]) return 'Unknown workflow';
    if (this.kind() === 'checkin') {
      if (!item.checkout) return 'Item is not checked out';
    } else if (this.kind() === 'return') {
      if (item.checkout || !(item.consumed_units || item.status === 'consumed'))
        return 'No recorded consumption to return';
    } else {
      if (!available(item)) return 'Item is unavailable for this workflow';
      if (['correct', 'transfer'].includes(this.kind()) && item.type !== 'box')
        return 'Only containers are allowed in this workflow';
      if (['consume', 'checkout'].includes(this.kind()) && !(item.qty! > 0))
        return 'A known positive quantity is required';
    }
    if (this.kind() === 'transfer') {
      if (!codes.includes(code) && codes.length >= 2)
        return 'Scan exactly two containers, source first';
      const source = this.api.context()!.state.items[codes[0]];
      if (item.qty === null || ((codes.length === 0 || codes[0] === code) && !(item.qty > 0)))
        return 'The source needs a positive quantity and the destination needs a known count';
      if (
        source &&
        (source.product_id !== item.product_id || source.warehouse_id !== item.warehouse_id)
      )
        return 'Containers must share a product and warehouse';
    }
    if (this.pickOrder && (!this.pickRows() || !this.pickRows()!.some(row => row.code === code)))
      return 'Item is not on the loaded pick list';
    return '';
  };

  protected clearPickList(): void {
    this.pickGeneration++;
    this.pickRows.set(null);
    this.codes.set([]);
    this.review.set(false);
  }

  // Bind scans to the newest loaded proposal. Stale requests must not restore a list after
  // its order/warehouse changed; the server repeats allowance checks when consuming it.
  protected async loadPickList(): Promise<void> {
    const generation = ++this.pickGeneration;
    this.pickBusy.set(true);
    this.pickRows.set(null);
    this.codes.set([]);
    this.error.set('');
    try {
      await this.api.command('pick-list-save', {
        order_id: this.pickOrder,
        warehouse_id: this.pickWarehouse,
      });
      const rows = await this.api.read<PickRow[]>('picking', {
        order_id: this.pickOrder,
        warehouse_id: this.pickWarehouse,
      });
      if (generation === this.pickGeneration) this.pickRows.set(rows);
    } catch (error) {
      if (generation === this.pickGeneration) this.error.set(this.api.message(error));
    } finally {
      this.pickBusy.set(false);
    }
  }
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
  protected nativeLinked = computed(() => this.rows().some(row => !!row.item?.product_lot_id));
  protected establishing = computed(
    () => this.kind() === 'correct' && this.rows().length === 1 && this.rows()[0].item?.qty === null
  );
  private subscription: Subscription;

  constructor() {
    this.subscription = combineLatest([this.route.paramMap, this.route.queryParamMap]).subscribe(
      ([params, query]) => {
        const routeKey = [
          params.get('kind'),
          query.get('code'),
          query.get('order'),
          query.get('warehouse'),
        ].join(':');
        if (routeKey === this.routeKey) return;
        this.routeKey = routeKey;
        this.kind.set(params.get('kind') || 'move');
        this.pickOrder = 0;
        this.pickWarehouse = 0;
        this.clearPickList();
        this.review.set(false);
        this.results.set([]);
        this.error.set('');
        const code = query.get('code');
        this.codes.set(code ? [code] : []);
        this.selected = {};
        this.quantities = {};
        this.warehouse = 0;
        this.destinationInitial = {};
        this.levels = {};
        this.person = 0;
        this.reason = '';
        this.postStock = true;
        this.referenceId = 0;
        this.referenceType =
          this.kind() === 'consume' && this.api.context()!.permissions.orders ? 'salesorder' : '';
        if (!this.api.context()!.permissions.stock) this.postStock = false;
        if (code) this.prepare();
        if (
          this.kind() === 'consume' &&
          this.api.context()!.permissions.orders &&
          query.get('order')
        ) {
          this.pickOrder = Number(query.get('order')) || 0;
          this.pickWarehouse = Number(query.get('warehouse')) || 0;
          if (this.pickOrder && this.pickWarehouse) void this.loadPickList();
        }
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
      const problem = this.validateScan(code, this.codes());
      if (problem) {
        this.error.set(problem + ': ' + code);
        return;
      }
      this.selected[code] = !!item;
      this.quantities[code] = this.kind() === 'correct' ? item?.qty || 0 : 1;
    }
    if (this.nativeLinked()) this.postStock = true;
    this.review.set(true);
  }

  protected async perform(): Promise<void> {
    if (this.busy() || this.destinationBusy()) return;
    this.busy.set(true);
    this.error.set('');
    this.results.set([]);
    try {
      const codes = this.codes().filter(code => this.selected[code]);
      if (!codes.length) throw new Error('Select at least one item');
      for (const code of codes) {
        const problem = this.validateScan(code, codes);
        if (problem) throw new Error(problem + ': ' + code);
        if (this.pickOrder) {
          const limit = this.pickRows()!
            .filter(row => row.code === code)
            .reduce((sum, row) => sum + row.take, 0);
          if (!(this.quantities[code] > 0) || this.quantities[code] > limit)
            throw new Error('Quantity exceeds the pick list: ' + code);
        }
      }
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
            message: 'Contents transferred between Dolibarr lots; warehouse total unchanged',
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
            reference_type: this.pickOrder ? 'salesorder' : this.referenceType,
            reference_id: this.pickOrder || this.referenceId,
            pick_order_id: this.pickOrder,
            pick_warehouse_id: this.pickWarehouse,
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

  protected adjustQuantity(code: string, delta: number): void {
    const minimum = this.kind() === 'correct' ? 0 : 1;
    const current = Number(this.quantities[code]);
    this.quantities[code] = Math.min(
      100000000,
      Math.max(minimum, (Number.isFinite(current) ? current : minimum) + delta)
    );
  }

  protected restart(): void {
    this.codes.set([]);
    this.results.set([]);
    this.review.set(false);
    this.error.set('');
    if (this.pickOrder && this.pickWarehouse) void this.loadPickList();
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
}
