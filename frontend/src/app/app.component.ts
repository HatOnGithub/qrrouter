import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { SharedModule } from '@shared/shared.module';
import { InventoryService } from '@services/inventory.service';
import { DolibarrThemeService } from '@services/dolibarr-theme.service';
import {
  faArrowsRotate,
  faBan,
  faBars,
  faBoxesStacked,
  faClipboardList,
  faQrcode,
  faRightLeft,
  faTags,
  faUserGear,
  faWarehouse,
} from '@fortawesome/free-solid-svg-icons';

@Component({
  selector: 'qrr-root',
  standalone: true,
  imports: [SharedModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.component.css',
})
export class AppComponent {
  protected inventory = inject(InventoryService);
  protected menuOpen = signal(false);
  protected recovering = signal(false);
  protected recoveryError = signal('');
  protected readonly icons = { refresh: faArrowsRotate, cancel: faBan, menu: faBars };

  protected async recoverNative(cancel = false): Promise<void> {
    this.recovering.set(true);
    this.recoveryError.set('');
    try {
      await this.inventory.command(cancel ? 'native-cancel' : 'native-recover', {});
      await this.inventory.refresh();
    } catch (error) {
      this.recoveryError.set(this.inventory.message(error));
    } finally {
      this.recovering.set(false);
    }
  }
  protected links = [
    { path: '/inventory', label: 'Inventory', icon: faBoxesStacked },
    { path: '/scan', label: 'Scan QR', icon: faQrcode },
    { path: '/labels', label: 'Print QR labels', icon: faTags },
    { path: '/locations', label: 'Bins and locations', icon: faWarehouse },
    { path: '/loans', label: 'Loans', icon: faRightLeft },
    { path: '/picking', label: 'Picking', icon: faClipboardList },
    { path: '/people', label: 'Personal warehouses', icon: faUserGear },
  ];

  constructor() {
    inject(DolibarrThemeService).apply();
    void this.inventory.refresh();
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      // Dolibarr's surrounding layout may not give its content a definite height.
      const resize = () => {
        const top = Math.max(0, host.getBoundingClientRect().top);
        host.style.setProperty(
          '--qrr-available-height',
          `${Math.max(0, window.innerHeight - top)}px`
        );
      };
      resize();
      window.addEventListener('resize', resize);
      const observer = new ResizeObserver(resize);
      if (host.parentElement) observer.observe(host.parentElement);
      destroy.onDestroy(() => {
        window.removeEventListener('resize', resize);
        observer.disconnect();
      });
    });
  }

  protected allowed(path: string): boolean {
    const p = this.inventory.context()?.permissions;
    if (path === '/people') return !!p?.admin;
    if (path === '/picking') return !!p?.orders;
    if (path === '/locations') return p?.locations !== false;
    if (['/inventory', '/scan', '/locations', '/loans'].includes(path)) return true;
    if (path.includes('checkout') || path.includes('checkin')) return !!p?.stock;
    return !!p?.manage;
  }
}
