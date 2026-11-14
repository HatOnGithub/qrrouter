import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { locationCode, physicalBinCode } from '@shared/scanner/codes';
import { toSignal } from '@angular/core/rxjs-interop';
import { SharedModule } from '@shared/shared.module';
import { CaptureComponent } from '@shared/scanner/capture.component';
import { InventoryService } from '@services/inventory.service';
import {
  faArrowLeft,
  faArrowRight,
  faArrowRightFromBracket,
  faArrowRightToBracket,
  faArrowRotateLeft,
  faArrowsUpDownLeftRight,
  faCamera,
  faClipboardCheck,
  faKeyboard,
  faMinus,
  faPlus,
  faRightLeft,
} from '@fortawesome/free-solid-svg-icons';

@Component({
  selector: 'qrr-scan',
  standalone: true,
  imports: [SharedModule, CaptureComponent],
  templateUrl: './scan.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './scan.component.css',
})
export class ScanComponent {
  protected readonly icons = {
    previous: faArrowLeft,
    next: faArrowRight,
    checkout: faArrowRightFromBracket,
    checkin: faArrowRightToBracket,
    return: faArrowRotateLeft,
    move: faArrowsUpDownLeftRight,
    camera: faCamera,
    correct: faClipboardCheck,
    manual: faKeyboard,
    consume: faMinus,
    register: faPlus,
    transfer: faRightLeft,
  };
  protected api = inject(InventoryService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  protected scanned(codes: string[]): void {
    const location = codes.find(locationCode);
    const bin = codes.find(physicalBinCode);
    if (location) void this.router.navigate(['/locations'], { queryParams: { location } });
    else if (bin) void this.router.navigate(['/bins'], { queryParams: { physical_bin: bin } });
    else {
      this.codes.set(codes);
      this.resultIndex.set(0);
    }
  }
  private params = toSignal(this.route.queryParamMap);
  protected inputMode = computed(() => this.params()?.get('input'));
  protected reviewing = computed(() => this.params()?.get('step') === 'review');
  protected codes = signal<string[]>(
    (this.route.snapshot.queryParamMap.get('codes') || '').split(',').filter(Boolean)
  );
  protected resultIndex = signal(0);
}
