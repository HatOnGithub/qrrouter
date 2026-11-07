import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Bootstrap, Level, Lookup } from '@core/models/inventory';

@Injectable({ providedIn: 'root' })
export class InventoryService {
  private http = inject(HttpClient);
  private base = new URL(
    document.querySelector('qrr-root')?.getAttribute('data-api') || '/custom/qrrouter/api.php',
    location.origin
  ).pathname;
  readonly context = signal<Bootstrap | null>(null);
  readonly items = computed(() => Object.values(this.context()?.state.items || {}));
  readonly loading = signal(false);
  readonly error = signal('');

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.context.set(await this.read<Bootstrap>('bootstrap'));
    } catch (error) {
      this.error.set(this.message(error));
    } finally {
      this.loading.set(false);
    }
  }

  read<T>(resource: string, values: Record<string, string | number> = {}): Promise<T> {
    return firstValueFrom(this.http.get<T>(this.base, { params: { resource, ...values } }));
  }

  async command<T>(action: string, payload: unknown): Promise<T> {
    const context = this.context();
    if (!context) throw new Error('Session is not loaded. Refresh the page.');
    // Dolibarr's main bootstrap validates the native form token before reaching our API.
    const body = new HttpParams()
      .set('token', context.token)
      .set('qrr_token', context.csrf)
      .set('payload', JSON.stringify(payload));
    return firstValueFrom(
      this.http.post<{ result: T }>(this.base, body, { params: { action } })
    ).then(r => r.result);
  }

  lookup(resource: string, q: string, type = ''): Promise<Lookup[]> {
    return this.read(resource, { q, type });
  }

  levels(warehouse: number): Promise<Level[]> {
    return this.read('levels', { warehouse_id: warehouse });
  }

  link(file: string, params: Record<string, string | number> = {}): string {
    return (
      this.base.replace(/api\.php$/, file) +
      '?' +
      new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
    );
  }

  message(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0)
        return 'Connection lost. Refresh inventory before repeating an operation.';
      return (
        error.error?.message || 'Request failed. Check your Dolibarr session and refresh inventory.'
      );
    }
    return error instanceof Error ? error.message : 'Request failed';
  }
}
