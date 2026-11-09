import { Component, inject, signal, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { SharedModule } from '@shared/shared.module';
import { CaptureComponent } from '@shared/scanner/capture.component';
import { InventoryService } from '@services/inventory.service';

@Component({
  selector: 'qrr-scan',
  standalone: true,
  imports: [SharedModule, CaptureComponent],
  templateUrl: './scan.component.html',
  styleUrl: './scan.component.css',
})
export class ScanComponent {
  protected api = inject(InventoryService);
  private route = inject(ActivatedRoute);
  private params = toSignal(this.route.queryParamMap);
  protected inputMode = computed(() => this.params()?.get('input'));
  protected reviewing = computed(() => this.params()?.get('step') === 'review');
  protected codes = signal<string[]>(
    (this.route.snapshot.queryParamMap.get('codes') || '').split(',').filter(Boolean)
  );
  protected resultIndex = signal(0);
}
