export interface RawItem {
  /** Opaque feed payload (usually a CAP XML string). */
  payload: unknown;
  fetchedAt: Date;
  sourceUrl?: string;
  etag?: string;
  lastModified?: string;
}
