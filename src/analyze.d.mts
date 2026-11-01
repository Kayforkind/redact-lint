/**
 * Types for the library surface. Kept in sync with analyze.mjs by the
 * typecheck step in CI: a consumer sample imports these and compiles.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CoveredRun {
  /** Masked unless `showText` was set. */
  text: string;
  /** 0–1 of the run's box covered by the cover. */
  coverage: number;
  box: Box;
}

export type CoverKind = 'paint-over' | 'whiteout' | 'opaque-cover' | 'image-cover';

export interface Cover {
  x: number;
  y: number;
  w: number;
  h: number;
  type: 'fill' | 'image';
  /** Hex colour, or null for an image. */
  color: string | null;
  luminance: number | null;
  opacity: number;
}

export interface Finding {
  page: number;
  kind: CoverKind;
  fill: Cover;
  covered: CoveredRun[];
}

export type NoteKind = 'form-field' | 'annotation' | string;

export interface Note {
  page: number | null;
  kind: NoteKind;
  label: string;
  /** Masked unless `showText` was set. */
  text: string;
}

export interface Summary {
  leaks: number;
  hiddenRuns: number;
  /** Present when annotation collection was enabled. */
  notes?: number;
  /** Present when a waiver applied. */
  suppressed?: number;
}

export interface AnalyzeResult {
  pages: number;
  textRuns: number;
  summary: Summary;
  findings: Finding[];
  notes: Note[];
}

export interface AnalyzeOptions {
  /** Fraction of a text box a cover must span. Default 0.6. */
  minCoverage?: number;
  /** Covers larger than this fraction of the page are backgrounds. Default 0.6. */
  maxFillArea?: number;
  /** Luminance at or below this is a black bar. Default 0.3. */
  darkLuma?: number;
  /** Luminance at or above this is a whiteout. Default 0.85. */
  lightLuma?: number;
  /** Leave covered text unmasked. Local review only. */
  showText?: boolean;
  /** Collect annotation and form-field text into `notes`. */
  annotations?: boolean;
  /** Password for an encrypted document. */
  password?: string;
}

/** Thrown when the document needs a password. */
export declare class EncryptedPdfError extends Error {
  constructor(message?: string);
}

export declare function analyzePdf(
  bytes: Uint8Array | ArrayBuffer,
  options?: AnalyzeOptions,
): Promise<AnalyzeResult>;

export declare function maskText(text: string): string;
