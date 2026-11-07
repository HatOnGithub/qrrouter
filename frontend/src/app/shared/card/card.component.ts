import { Component, input } from '@angular/core';

@Component({
  selector: 'qrr-card',
  standalone: true,
  templateUrl: './card.component.html',
  styleUrl: './card.component.css',
})
export class CardComponent {
  readonly title = input('');
}
