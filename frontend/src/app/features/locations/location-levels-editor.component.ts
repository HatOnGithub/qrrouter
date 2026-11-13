import { Component, effect, input, output, signal, ChangeDetectionStrategy } from '@angular/core';
import { SharedModule } from '@shared/shared.module';
import { Level } from '@core/models/inventory';
import { faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';

export interface LocationLevelChanges {
  names: string[];
  datatypes: string[];
  option_additions: string[][];
}

interface LevelRow {
  key: number;
  name: string;
  level?: Level;
  additions: string;
  datatype: string;
}

/** Edits level names and option additions; the page owns persistence and reloads. */
@Component({
  selector: 'qrr-location-levels-editor',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './location-levels-editor.component.html',
  styleUrl: './location-levels-editor.component.css',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class LocationLevelsEditorComponent {
  readonly levels = input<Level[]>([]);
  readonly disabled = input(false);
  readonly saved = output<LocationLevelChanges>();
  protected rows = signal<LevelRow[]>([]);
  protected readonly icons = { add: faPlus, remove: faXmark };
  protected readonly datatypes = [
    { value: 'text', label: 'Text' },
    { value: 'number', label: 'Number' },
    { value: 'letter', label: 'Letters (A–Z)' },
    { value: 'list', label: 'Option list' },
  ];
  private nextKey = -1;

  constructor() {
    effect(() =>
      this.rows.set(
        this.levels().map(level => ({
          key: level.id,
          name: level.label,
          datatype: level.datatype,
          level,
          additions: '',
        }))
      )
    );
  }

  protected add(): void {
    if (this.disabled() || this.rows().length >= 8) return;
    this.rows.update(rows => [
      ...rows,
      { key: this.nextKey--, name: '', datatype: 'text', additions: '' },
    ]);
  }

  protected remove(row: LevelRow): void {
    if (this.disabled() || row.level) return;
    this.rows.update(rows => rows.filter(candidate => candidate.key !== row.key));
  }

  protected valid(): boolean {
    const names = this.rows().map(row => row.name.trim().toLowerCase());
    return (
      names.length > 0 &&
      names.length <= 8 &&
      names.every(Boolean) &&
      new Set(names).size === names.length
    );
  }

  protected save(): void {
    if (this.disabled() || !this.valid()) return;
    this.saved.emit({
      names: this.rows().map(row => row.name.trim()),
      datatypes: this.rows().map(row => row.datatype),
      option_additions: this.rows().map(row =>
        ['list', 'letter'].includes(row.datatype)
          ? row.additions
              .split(/\r?\n/)
              .map(value => value.trim())
              .filter(Boolean)
          : []
      ),
    });
  }
}
