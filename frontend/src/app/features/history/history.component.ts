import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { SharedModule } from '@shared/shared.module';
import { InventoryService } from '@services/inventory.service';
import { ActionHistoryPage } from '@core/models/inventory';

/** One paged history view for the global route and an exact-code panel embedded in QR details. */
@Component({
  selector: 'qrr-history',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './history.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class HistoryComponent {
  protected api = inject(InventoryService);
  readonly code = input('');
  private params = toSignal(inject(ActivatedRoute).queryParamMap);
  protected exactCode = computed(() => this.code() || this.params()?.get('code') || '');
  protected permitted = computed(
    () => !!this.api.context()?.permissions.history || !!this.api.context()?.permissions.admin
  );
  private sequence = 0;
  protected data = signal<ActionHistoryPage | null>(null);
  protected busy = signal(false);
  protected error = signal('');
  protected query = '';
  protected actor = 0;
  protected event = '';
  protected from = '';
  protected to = '';
  protected readonly operations: Record<string, string> = {
    create: 'Create item',
    bulk: 'Create label batch',
    register: 'Register items',
    update: 'Edit item',
    'delete-unassigned': 'Delete unassigned QR',
    count: 'Establish container count',
    move: 'Move items',
    consume: 'Consume items',
    return: 'Return items',
    correct: 'Correct quantity',
    checkout: 'Check out items',
    checkin: 'Check in items',
    'box-transfer': 'Transfer container contents',
    mapping: 'Assign employee warehouse',
    'resolve-mapping': 'Resolve employee warehouse',
    'label-settings': 'Change label format',
    'location-configure': 'Configure location levels',
    'location-import': 'Import locations',
    'physical-bin-create': 'Create physical bin',
    'physical-bin-assign': 'Pack or unpack items',
    'physical-bin-move-start': 'Start physical bin move',
    'physical-bin-pack': 'Pack items into a physical bin',
    'physical-bin-unpack': 'Unpack items from a physical bin',
    'physical-bin-move-finish': 'Complete physical bin move',
    'pick-list-save': 'Save pick list',
    'pick-list-complete': 'Complete pick list manually',
    import: 'Import inventory',
    'native-stage': 'Start native synchronization',
    'native-finish': 'Complete native synchronization',
    'native-cancel': 'Cancel native synchronization',
    stage: 'Start stock operation',
    finish: 'Complete stock operation',
    reconcile: 'Reconcile stock operation',
    'handoff-stage': 'Start employee transfer',
    'handoff-finish': 'Complete employee transfer',
    'handoff-reconcile': 'Reconcile employee transfer',
  };
  constructor() {
    effect(() => {
      this.exactCode();
      if (this.permitted())
        untracked(() => {
          this.data.set(null);
          void this.load();
        });
    });
  }
  protected name(operation: string): string {
    return this.operations[operation] || operation;
  }
  protected async load(page = 1): Promise<void> {
    if (!this.permitted()) return;
    // A slower earlier filter/page request must not replace the latest visible results.
    const request = ++this.sequence;
    this.busy.set(true);
    this.error.set('');
    try {
      if (this.from && this.to && this.from > this.to)
        throw new Error('Start date must be on or before end date');
      // Selected days are local. Advance the end by one local calendar day, then send UTC
      // boundaries to the repository's inclusive-from/exclusive-to filter (including DST).
      const from = this.from ? new Date(this.from + 'T00:00:00').toISOString() : '';
      const end = this.to ? new Date(this.to + 'T00:00:00') : null;
      if (end) end.setDate(end.getDate() + 1);
      const data = await this.api.read<ActionHistoryPage>('history', {
        page,
        code: this.exactCode(),
        q: this.query,
        event: this.event,
        user_id: this.actor || 0,
        from,
        to: end?.toISOString() || '',
      });
      if (request === this.sequence) this.data.set(data);
    } catch (error) {
      if (request === this.sequence) this.error.set(this.api.message(error));
    } finally {
      if (request === this.sequence) this.busy.set(false);
    }
  }
}
