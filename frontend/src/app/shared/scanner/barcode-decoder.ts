import jsQR from 'jsqr';
import {
  ChecksumException,
  Code128Reader,
  DataMatrixReader,
  BinaryBitmap,
  BitArray,
  DecodeHintType,
  HybridBinarizer,
  FormatException,
  NotFoundException,
  PDF417Reader,
  RGBLuminanceSource,
} from '@zxing/library';

/** A secondary 1D threshold avoids treating a dark surround as the white-label histogram peak. */
class ContrastBinarizer extends HybridBinarizer {
  fraction = 1 / 4;
  override getBlackRow(y: number, row: BitArray): BitArray {
    const values = this.getLuminanceSource().getRow(y);
    let low = 255;
    let high = 0;
    for (const value of values) {
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    const threshold = low + (high - low) * this.fraction;
    row = new BitArray(values.length);
    for (let x = 0; x < values.length; x++) if (values[x] < threshold) row.set(x);
    return row;
  }
}

/** Decode supported carriers; domain ID/checksum validation remains a separate capture step. */
export class BarcodeDecoder {
  private readonly readers = [new DataMatrixReader(), new Code128Reader(), new PDF417Reader()];
  private readonly hints = new Map<DecodeHintType, unknown>([[DecodeHintType.TRY_HARDER, true]]);

  decode(pixels: Uint8ClampedArray, width: number, height: number): string | null {
    const qr = jsQR(pixels, width, height, { inversionAttempts: 'attemptBoth' });
    if (qr) return qr.data;
    // RGBLuminanceSource expects luminance bytes (or packed ARGB), not an RGBA byte buffer.
    const gray = new Uint8ClampedArray(width * height);
    for (let i = 0; i < gray.length; i++)
      gray[i] = (pixels[i * 4] + 2 * pixels[i * 4 + 1] + pixels[i * 4 + 2]) / 4;
    const result = this.read(gray, width, height);
    if (result) return result;
    // A 1D reader searches rows. Rotate once so vertical bars work with the same hints too.
    const rotated = new Uint8ClampedArray(gray.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) rotated[x * height + height - y - 1] = gray[y * width + x];
    return this.read(rotated, height, width);
  }

  private read(gray: Uint8ClampedArray, width: number, height: number): string | null {
    const source = new RGBLuminanceSource(gray, width, height);
    for (const luminance of [source, source.invert()]) {
      const bitmap = new BinaryBitmap(new HybridBinarizer(luminance));
      for (const reader of this.readers) {
        try {
          return reader.decode(bitmap, this.hints).getText();
        } catch (error) {
          if (!(
            error instanceof NotFoundException ||
            error instanceof ChecksumException ||
            error instanceof FormatException
          ))
            throw error;
        } finally {
          reader.reset();
        }
      }
      const linear = this.readers[1];
      // Video color conversion and antialiasing change the separation between dark bars,
      // the surround and white paper. One fixed fraction can merge the surround into bars.
      // Bound the fallback to three thresholds and normal row sampling to keep blank frames cheap.
      for (const fraction of [1 / 4, 1 / 8, 3 / 8]) {
        const contrast = new ContrastBinarizer(luminance);
        contrast.fraction = fraction;
        try {
          return linear.decode(new BinaryBitmap(contrast)).getText();
        } catch (error) {
          if (!(
            error instanceof NotFoundException ||
            error instanceof ChecksumException ||
            error instanceof FormatException
          ))
            throw error;
        } finally {
          linear.reset();
        }
      }
    }
    return null;
  }
}
