import { Component, inject, signal } from '@angular/core';
import { SharedModule } from '@shared/shared.module';
import { ScannerComponent } from '@shared/scanner/scanner.component';
import { InventoryService } from '@services/inventory.service';

@Component({
  selector: 'qrr-scan',
  standalone: true,
  imports: [SharedModule, ScannerComponent],
  templateUrl: './scan.component.html',
})
export class ScanComponent {
  protected api = inject(InventoryService);
  protected codes = signal<string[]>([]);
}
