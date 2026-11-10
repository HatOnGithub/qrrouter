import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslationService } from '@services/translation.service';

@Pipe({ name: 't', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  private translations = inject(TranslationService);

  transform(value: string): string {
    return this.translations.text(value);
  }
}
