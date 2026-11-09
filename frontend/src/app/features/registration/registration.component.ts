import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SharedModule } from '@shared/shared.module';
import { CaptureComponent } from '@shared/scanner/capture.component';
import { InventoryService } from '@services/inventory.service';

/** Collects identifiers only. Product and inventory details belong to the editor page. */
@Component({
  selector: 'qrr-registration-selection',
  standalone: true,
  imports: [SharedModule, CaptureComponent],
  templateUrl: './registration.component.html',
  styleUrl: './registration.component.css',
})
export class RegistrationComponent {
  protected api = inject(InventoryService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  protected codes = signal(
    (
      this.route.snapshot.queryParamMap.get('codes') ||
      this.route.snapshot.queryParamMap.get('code') ||
      ''
    )
      .split(',')
      .filter(Boolean)
  );
  protected thumbnail = history.state?.thumbnail || '';
  private draft = history.state?.draft;

  protected continue(): void {
    void this.router.navigate(['/register/details'], {
      queryParams: {
        codes: this.codes().join(','),
        mode: this.route.snapshot.queryParamMap.get('mode') || 'generic',
        input: this.route.snapshot.queryParamMap.get('input') || 'camera',
      },
      state: { thumbnail: this.thumbnail, draft: this.draft },
    });
  }
}
