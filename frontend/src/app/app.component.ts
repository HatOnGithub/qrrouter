import { Component, DestroyRef, ElementRef, afterNextRender, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { SharedModule } from '@shared/shared.module';
import { InventoryService } from '@services/inventory.service';
import { DolibarrThemeService } from '@services/dolibarr-theme.service';

@Component({
  selector: 'qrr-root',
  standalone: true,
  imports: [SharedModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  protected inventory = inject(InventoryService);
  protected menuOpen = signal(false);
  protected links = [
    { path: '/inventory', label: 'Inventory', icon: '▦' },
    { path: '/scan', label: 'Scan QR', icon: '⌗' },
    { path: '/register', label: 'Register items', icon: '+' },
    { path: '/labels', label: 'Print QR labels', icon: '▤' },
    { path: '/workflow/move', label: 'Move items', icon: '→' },
    { path: '/workflow/consume', label: 'Consume items', icon: '−' },
    { path: '/workflow/checkout', label: 'Check out items', icon: '↗' },
    { path: '/workflow/checkin', label: 'Check in items', icon: '↙' },
    { path: '/locations', label: 'Bins and locations', icon: '▧' },
    { path: '/loans', label: 'Loans', icon: '⇄' },
    { path: '/picking', label: 'Picking', icon: '☷' },
    { path: '/people', label: 'Personal warehouses', icon: '♙' },
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
    if (['/inventory', '/scan', '/locations', '/loans'].includes(path)) return true;
    if (path.includes('checkout') || path.includes('checkin')) return !!p?.stock;
    return !!p?.manage;
  }
}
