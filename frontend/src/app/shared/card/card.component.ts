import { Component, input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'qrr-card',
  standalone: true,
  templateUrl: './card.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './card.component.css',
})
export class CardComponent {
  readonly title = input('');
}
