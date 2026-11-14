import {
  Component,
  computed,
  ElementRef,
  OnDestroy,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { BarcodeDecoder } from './barcode-decoder';
import { SharedModule } from '@shared/shared.module';
import { locationCode, physicalBinCode, normalizeCode, validCode } from './codes';
import { TranslationService } from '@services/translation.service';
import {
  faCamera,
  faCircle,
  faKeyboard,
  faPlus,
  faRotateRight,
  faStop,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';

/**
 * Camera/manual capture with shared normalization and feature-supplied eligibility validation.
 * Capturing a valid identifier never proves access or reserves stock; the gateway rechecks it.
 */
@Component({
  selector: 'qrr-scanner',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './scanner.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './scanner.component.css',
})
export class ScannerComponent implements OnDestroy {
  protected readonly icons = {
    camera: faCamera,
    status: faCircle,
    manual: faKeyboard,
    add: faPlus,
    restart: faRotateRight,
    stop: faStop,
    remove: faXmark,
  };
  private translations = inject(TranslationService);
  readonly entryMode = input<'camera' | 'manual'>('camera');
  readonly modeChanged = output<'camera' | 'manual'>();
  protected manualMode = computed(() => this.entryMode() === 'manual');
  private ready = signal(false);
  private video = viewChild<ElementRef<HTMLVideoElement>>('video');
  readonly multiple = input(true);
  readonly content = input<'items' | 'locations' | 'items-or-bins' | 'any'>('items');
  readonly initial = input<string[]>([]);
  readonly validate = input<(code: string, codes: string[]) => string>(() => '');
  readonly changed = output<string[]>();
  readonly thumbnail = output<string>();
  protected codes = signal<string[]>([]);
  protected error = signal('');
  protected camera = signal(false);
  protected starting = signal(false);
  protected manual = '';
  private stream?: MediaStream;
  private frame = 0;
  private generation = 0;
  private canvas = document.createElement('canvas');
  private decoder = new BarcodeDecoder();
  private lastDecode = 0;

  constructor() {
    effect(() => this.codes.set([...this.initial()]));
    effect(() => {
      const ready = this.ready();
      const manual = this.manualMode();
      if (ready) {
        if (manual) {
          this.stop();
          this.error.set('');
        } else void this.start();
      }
    });
    afterNextRender(() => this.ready.set(true));
  }

  protected switchInput(): void {
    this.modeChanged.emit(this.manualMode() ? 'camera' : 'manual');
  }

  protected add(raw = this.manual): void {
    this.error.set('');
    const values = raw
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map(normalizeCode);
    // A camera can contain a URL; manual paste of a URL also remains one token.
    if (!values.length) return;
    const next = [...this.codes()];
    for (const code of values) {
      const accepted =
        (validCode(code) && this.content() !== 'locations') ||
        (locationCode(code) && ['locations', 'any'].includes(this.content())) ||
        (physicalBinCode(code) && ['items-or-bins', 'any'].includes(this.content()));
      if (!accepted) {
        this.error.set(this.translations.text('Invalid identifier') + ': ' + code.slice(0, 52));
        return;
      }
      const problem = this.validate()(code, next);
      if (problem) {
        this.error.set(this.translations.text(problem) + ': ' + code);
        return;
      }
      if (!next.includes(code)) next.push(code);
    }
    if (next.length > (this.multiple() ? 200 : 1)) {
      this.error.set(
        this.translations.text(
          this.multiple() ? 'Maximum 200 codes per round' : 'Scan exactly one QR label'
        )
      );
      return;
    }
    this.codes.set(next);
    this.changed.emit(next);
    this.manual = '';
  }

  protected remove(code: string): void {
    this.codes.update(rows => rows.filter(row => row !== code));
    this.changed.emit(this.codes());
  }

  // stop() advances the generation. A late permission/play result from an earlier camera
  // session must release its stream instead of restarting capture after navigation or stop.
  protected async start(): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.error.set('');
    this.starting.set(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          this.translations.text(
            'Camera API unavailable. Open this page over HTTPS and allow camera access.'
          )
        );
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.stream = stream;
      this.camera.set(true);
      // The video stays mounted so a granted stream is never attached to a destroyed element.
      const video = this.video()!.nativeElement;
      video.srcObject = stream;
      await video.play();
      if (generation === this.generation)
        this.frame = requestAnimationFrame(() => this.decode(generation));
    } catch (error) {
      if (generation === this.generation) {
        this.stop();
        this.error.set(error instanceof Error ? error.message : 'Camera unavailable');
      }
    } finally {
      if (generation === this.generation) this.starting.set(false);
    }
  }

  private decode(generation: number): void {
    if (generation !== this.generation || !this.stream) return;
    // Bound multi-format decoding work while keeping the camera preview smooth.
    if (performance.now() - this.lastDecode < 100) {
      this.frame = requestAnimationFrame(() => this.decode(generation));
      return;
    }
    this.lastDecode = performance.now();
    const video = this.video()!.nativeElement;
    if (video.readyState >= 2 && video.videoWidth) {
      const scale = Math.min(1, 800 / video.videoWidth);
      this.canvas.width = Math.round(video.videoWidth * scale);
      this.canvas.height = Math.round(video.videoHeight * scale);
      const context = this.canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
      const pixels = context.getImageData(0, 0, this.canvas.width, this.canvas.height);
      const result = this.decoder.decode(pixels.data, pixels.width, pixels.height);
      if (result) {
        const code = normalizeCode(result);
        if (
          (validCode(code) || locationCode(code) || physicalBinCode(code)) &&
          !this.codes().includes(code)
        ) {
          this.add(code);
          if (this.codes().includes(code)) {
            const small = document.createElement('canvas');
            small.width = 192;
            small.height = Math.round((192 * video.videoHeight) / video.videoWidth);
            if (small.height > 256) {
              small.height = 256;
              small.width = Math.round((256 * video.videoWidth) / video.videoHeight);
            }
            small.getContext('2d')!.drawImage(video, 0, 0, small.width, small.height);
            this.thumbnail.emit(small.toDataURL('image/jpeg', 0.65));
            if (!this.multiple()) {
              this.stop();
              return;
            }
          }
        }
      }
    }
    this.frame = requestAnimationFrame(() => this.decode(generation));
  }

  protected stop(): void {
    ++this.generation;
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    const video = this.video()?.nativeElement;
    if (video) video.srcObject = null;
    this.camera.set(false);
    this.starting.set(false);
  }

  ngOnDestroy(): void {
    this.stop();
  }
}
