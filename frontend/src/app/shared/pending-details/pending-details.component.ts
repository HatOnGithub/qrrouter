import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { PendingDetail } from '@core/models/inventory';
import { TranslatePipe } from '../translate.pipe';

/**
 * Read-only foldout for server-selected intent rows, shared by global and per-QR notices.
 * Optional/empty details support unavailable or older metadata without exposing raw recovery state.
 */
@Component({
  selector: 'qrr-pending-details',
  standalone: true,
  imports: [DatePipe, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details>
      <summary>{{ 'More details' | t }}</summary>
      <p>{{ pending().id }} · {{ operation() | t }} · {{ pending().at | date: 'medium' }}</p>
      <p>
        {{ 'These are the requested changes. They may already have been applied in Dolibarr.' | t }}
      </p>
      @if (pending().details?.length) {
        <div class="table-scroll">
          <table>
            <caption>{{ 'Requested synchronization changes' | t }}</caption>
            <thead>
              <tr>
                <th scope="col">{{ 'QR code' | t }}</th>
                <th scope="col">{{ 'Change' | t }}</th>
                <th scope="col">{{ 'Before' | t }}</th>
                <th scope="col">{{ 'Intended result' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (row of pending().details; track $index) {
                <tr>
                  <td>{{ row.code || '—' }}</td>
                  <th scope="row">{{ row.field | t }}</th>
                  <td>{{ row.before ?? '—' }}</td>
                  <td>
                    @if (row.field === 'Native synchronization') {
                      {{ row.after ?? '—' | t }}
                    } @else {
                      {{ row.after ?? '—' }}
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p>{{ 'No additional details are available with your current permissions.' | t }}</p>
      }
    </details>
  `,
  styles: `
    :host {
      display: block;
      margin-block: 1rem;
    }
    summary {
      cursor: pointer;
      font-weight: 600;
    }
    .table-scroll {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    caption {
      text-align: start;
      padding-block: 0.5rem;
    }
    th,
    td {
      text-align: start;
      padding: 0.5rem;
      border-bottom: 1px solid currentColor;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
  `,
})
export class PendingDetailsComponent {
  readonly pending = input.required<{ id: string; at: string; details?: PendingDetail[] }>();
  readonly operation = input.required<string>();
}
