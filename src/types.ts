export type PageSection = {
  /** Absolute Y position in CSS px */
  y: number;
  /** Height in CSS px */
  h: number;
  kind: 'hero' | 'heading' | 'cards' | 'testimonial' | 'pricing' | 'stats' | 'gallery' | 'cta';
};

export type CaptureMeta = {
  url: string;
  title: string;
  /** CSS pixel width of the capture viewport */
  cssWidth: number;
  /** CSS pixel height of the captured area (may be capped) */
  cssHeight: number;
  /** Actual pixel dimensions of the saved image — the source of truth the
   * camera math uses. DOM-reported heights lie on animated sites. */
  imageWidth: number;
  imageHeight: number;
  deviceScaleFactor: number;
  /** 'full' or 'lite' (crash-retry profile: 1x density, no WebGL) */
  mode: 'full' | 'lite';
  /** Detected page sections for the smart camera plan (CSS px coordinates) */
  sections: PageSection[];
  imageFile: string;
  capturedAt: string;
};
