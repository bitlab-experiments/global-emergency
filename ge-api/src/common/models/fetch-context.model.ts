export interface FetchContext {
  now?: Date;
  /** Value from a previous response `ETag` header. */
  etag?: string;
  /** Value from a previous response `Last-Modified` header (HTTP-date). */
  lastModified?: string;
  cursor?: string;
  signal?: AbortSignal;
}
