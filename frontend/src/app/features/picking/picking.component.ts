import { Component, inject, signal, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { SharedModule } from '@shared/shared.module';
import { LookupComponent } from '@shared/lookup/lookup.component';
import { InventoryService } from '@services/inventory.service';
import { PickList, PickRow } from '@core/models/inventory';
import { faListCheck, faPrint } from '@fortawesome/free-solid-svg-icons';
import { faSquare } from '@fortawesome/free-regular-svg-icons';
import { printLanguages } from '../../../print/language';

/** Allocation proposals and saved order progress; displaying a proposal does not reserve stock. */
@Component({
  selector: 'qrr-picking',
  standalone: true,
  imports: [SharedModule, LookupComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './picking.component.html',
})
export class PickingComponent implements OnInit {
  protected readonly icons = { preview: faListCheck, print: faPrint, unchecked: faSquare };
  protected api = inject(InventoryService);
  protected orderType = this.api.context()!.permissions.orders ? 'salesorder' : 'production';
  protected warehouse = 0;
  protected order = 0;
  protected orderName = '';
  protected busy = signal(false);
  protected error = signal('');
  protected rows = signal<PickRow[]>([]);
  protected previewed = signal(false);
  protected readonly languages = printLanguages;
  protected printLocale =
    printLanguages.find(
      language => language.id.slice(0, 2) === this.api.context()!.locale.slice(0, 2)
    )?.id || 'en_US';
  protected loadingLanguage = signal(false);
  protected languageReady = signal(true);
  private outputTranslations = signal(this.api.context()!.translations);
  private previewSequence = 0;

  protected resetPreview(clearOrder = false): void {
    ++this.previewSequence;
    this.rows.set([]);
    this.previewed.set(false);
    this.busy.set(false);
    this.error.set('');
    if (clearOrder) {
      this.order = 0;
      this.orderName = '';
    }
  }

  protected pt(text: string): string {
    return this.outputTranslations()?.[text] || text;
  }

  protected async changeLanguage(): Promise<void> {
    this.loadingLanguage.set(true);
    this.languageReady.set(false);
    this.error.set('');
    const locale = this.printLocale;
    try {
      const translations = await this.api.read<Record<string, string>>('print-translations', {
        lang: locale,
      });
      if (locale !== this.printLocale) return;
      this.outputTranslations.set(translations);
      this.languageReady.set(true);
    } catch (error) {
      if (locale === this.printLocale) this.error.set(this.api.message(error));
    } finally {
      if (locale === this.printLocale) this.loadingLanguage.set(false);
    }
  }

  protected lists = signal<PickList[]>([]);
  protected completing = 0;
  protected completionReason = '';

  ngOnInit(): void {
    if (this.api.context()!.permissions.orders) void this.loadLists();
  }

  private async loadLists(): Promise<void> {
    try {
      this.lists.set(await this.api.read<PickList[]>('pick-lists'));
    } catch (error) {
      this.error.set(this.api.message(error));
    }
  }

  protected async saveList(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.command('pick-list-save', {
        order_id: this.order,
        warehouse_id: this.warehouse,
      });
      await this.loadLists();
    } catch (error) {
      this.error.set(this.api.message(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async completeList(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.command('pick-list-complete', {
        order_id: this.completing,
        reason: this.completionReason,
      });
      this.completing = 0;
      this.completionReason = '';
      this.rows.set([]);
      await this.loadLists();
    } catch (error) {
      this.error.set(this.api.message(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async preview(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const sequence = ++this.previewSequence;
    try {
      const rows = await this.api.read<PickRow[]>('picking', {
        warehouse_id: this.warehouse,
        order_id: this.order,
        order_type: this.orderType,
      });
      if (sequence === this.previewSequence) {
        this.rows.set(rows);
        this.previewed.set(true);
      }
    } catch (error) {
      if (sequence !== this.previewSequence) return;
      this.rows.set([]);
      this.previewed.set(false);
      this.error.set(this.api.message(error));
    } finally {
      if (sequence === this.previewSequence) this.busy.set(false);
    }
  }

  protected print(): void {
    if (this.languageReady() && !this.loadingLanguage()) window.print();
  }
}
