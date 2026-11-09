import { Component, computed, inject, input, output, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { ScannerComponent } from './scanner.component';

/** Owns capture-page navigation; the scanner only captures and validates identifiers. */
@Component({
  selector: 'qrr-capture',
  standalone: true,
  imports: [ScannerComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <qrr-scanner
      [multiple]="multiple()"
      [initial]="initial()"
      [entryMode]="mode()"
      (modeChanged)="switchMode($event)"
      (changed)="changed.emit($event)"
      (thumbnail)="thumbnail.emit($event)"
    />
  `,
})
export class CaptureComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private params = toSignal(this.route.queryParamMap);
  readonly multiple = input(true);
  readonly initial = input<string[]>([]);
  readonly changed = output<string[]>();
  readonly thumbnail = output<string>();
  protected mode = computed(() => (this.params()?.get('input') === 'manual' ? 'manual' : 'camera'));

  protected switchMode(input: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { input },
      queryParamsHandling: 'merge',
    });
  }
}
