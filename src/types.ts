export type CaptureMeta = {
  url: string;
  title: string;
  /** CSS pixel width of the capture viewport */
  cssWidth: number;
  /** CSS pixel height of the captured area (may be capped) */
  cssHeight: number;
  deviceScaleFactor: number;
  imageFile: string;
  capturedAt: string;
};

export type ReelInputProps = {
  clientName: string;
  headline: string;
  beforeImage: string;
  afterImage: string;
  beforeMeta: { width: number; height: number; url: string };
  afterMeta: { width: number; height: number; url: string };
  beforeSeconds: number;
  afterSeconds: number;
  brandName: string;
  cta: string;
  accentColor: string;
  musicSrc: string | null;
};
