import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NativeLinksService } from '@services/native-links.service';

@Component({
  selector: 'qrr-native-link',
  standalone: true,
  templateUrl: './native-link.component.html',
  styleUrl: './native-link.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NativeLinkComponent {
  private links = inject(NativeLinksService);
  readonly type = input('');
  readonly id = input<string | number | null | undefined>(0);
  readonly label = input<string | number | null | undefined>('');
  protected href = computed(() => this.links.link(this.type(), this.id()));
}
