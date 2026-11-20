import { XMLParser } from 'fast-xml-parser';
import type { FetchContext } from '../../common/models/fetch-context.model';
import type {
  AlertTier,
  NormalizedAlert,
} from '../../common/models/normalize-alert.model';
import type { RawItem } from '../../common/models/raw-item.model';
import type { SourceConfig } from '../../common/models/source-config.model';
import { CapParseError } from '../cap/cap.parser';
import type { CapParser } from '../cap/cap.module';
import type { SourceAdapter } from './source-adapter.interface';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ENTRY_FETCHES = 50;
const USER_AGENT =
  'GlobalEmergencyMonitor/0.1 (+https://github.com/local/global-emergency; aggregator-not-official)';

export type HttpGet = (url: string, init?: RequestInit) => Promise<Response>;

export class CapAtomFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'CapAtomFetchError';
  }
}

/**
 * Generic CAP / Atom / RSS adapter. One class, many instances — each
 * `sources.yaml` row with `type: cap-atom` gets its own configured copy.
 */
export class CapAtomAdapter implements SourceAdapter {
  readonly type = 'cap-atom' as const;
  readonly key: string;
  readonly tier: AlertTier;
  readonly url: string;
  readonly intervalSec: number;

  private readonly lang?: string;
  private readonly httpGet: HttpGet;
  private readonly timeoutMs: number;

  constructor(
    config: SourceConfig,
    private readonly caps: CapParser,
    options?: { httpGet?: HttpGet; timeoutMs?: number },
  ) {
    if (config.type !== 'cap-atom') {
      throw new Error(
        `CapAtomAdapter requires type cap-atom, got ${config.type}`,
      );
    }
    this.key = config.key;
    this.tier = config.tier;
    this.url = config.url;
    this.intervalSec = config.intervalSec;
    this.lang = config.lang;
    this.httpGet = options?.httpGet ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async fetch(ctx: FetchContext = {}): Promise<RawItem[]> {
    const fetchedAt = ctx.now ?? new Date();
    const response = await this.request(this.url, ctx);
    if (response.status === 304) return [];

    const body = await response.text();
    const etag = headerValue(response, 'etag');
    const lastModified = headerValue(response, 'last-modified');
    const contentType = headerValue(response, 'content-type') ?? '';

    if (looksLikeCap(body)) {
      return [
        {
          payload: body,
          fetchedAt,
          sourceUrl: this.url,
          etag,
          lastModified,
        },
      ];
    }

    if (looksLikeFeed(body, contentType)) {
      return this.itemsFromFeed(body, {
        fetchedAt,
        etag,
        lastModified,
        signal: ctx.signal,
      });
    }

    throw new CapAtomFetchError(
      `${this.key}: response is not CAP XML or an Atom/RSS feed`,
      response.status,
    );
  }

  normalize(item: RawItem): NormalizedAlert[] {
    if (typeof item.payload !== 'string' || !item.payload.trim()) {
      throw new CapParseError('CAP Atom raw item payload must be XML text');
    }
    return this.caps.parse(item.payload, {
      source: this.key,
      tier: this.tier,
      sourceUrl: item.sourceUrl ?? this.url,
      lang: this.lang,
    });
  }

  private async itemsFromFeed(
    xml: string,
    meta: {
      fetchedAt: Date;
      etag?: string;
      lastModified?: string;
      signal?: AbortSignal;
    },
  ): Promise<RawItem[]> {
    const entries = extractFeedEntries(xml);
    const items: RawItem[] = [];

    for (const entry of entries) {
      if (items.length >= MAX_ENTRY_FETCHES) break;

      if (entry.embeddedCap) {
        items.push({
          payload: entry.embeddedCap,
          fetchedAt: meta.fetchedAt,
          sourceUrl: entry.linkUrl ?? this.url,
          etag: meta.etag,
          lastModified: meta.lastModified,
        });
        continue;
      }

      if (!entry.linkUrl) continue;
      const linked = await this.request(entry.linkUrl, {
        signal: meta.signal,
      });
      if (linked.status === 304) continue;
      const payload = await linked.text();
      if (!looksLikeCap(payload)) continue;
      items.push({
        payload,
        fetchedAt: meta.fetchedAt,
        sourceUrl: entry.linkUrl,
        etag: headerValue(linked, 'etag') ?? meta.etag,
        lastModified: headerValue(linked, 'last-modified') ?? meta.lastModified,
      });
    }

    // Feed with no per-entry CAP: let CapParser walk the whole document
    // (handles Atom entries whose content is escaped CAP XML).
    if (items.length === 0 && looksLikeFeed(xml, 'application/atom+xml')) {
      items.push({
        payload: xml,
        fetchedAt: meta.fetchedAt,
        sourceUrl: this.url,
        etag: meta.etag,
        lastModified: meta.lastModified,
      });
    }

    return items;
  }

  private async request(url: string, ctx: FetchContext): Promise<Response> {
    const headers: Record<string, string> = {
      Accept:
        'application/atom+xml, application/rss+xml, application/xml, text/xml, application/cap+xml, */*',
      'User-Agent': USER_AGENT,
    };
    if (ctx.etag) headers['If-None-Match'] = ctx.etag;
    if (ctx.lastModified) headers['If-Modified-Since'] = ctx.lastModified;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    ctx.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await this.httpGet(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      if (response.status === 304) return response;
      if (!response.ok) {
        throw new CapAtomFetchError(
          `${this.key}: fetch failed with HTTP ${response.status}`,
          response.status,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof CapAtomFetchError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CapAtomFetchError(`${this.key}: fetch timed out or aborted`);
      }
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'unknown error';
      throw new CapAtomFetchError(`${this.key}: fetch failed (${message})`);
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onAbort);
    }
  }
}

interface FeedEntry {
  embeddedCap?: string;
  linkUrl?: string;
}

const feedParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  ignoreDeclaration: true,
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: {
    enabled: true,
    maxEntityCount: 0,
    maxEntitySize: 0,
    maxExpansionDepth: 1,
    maxTotalExpansions: 100_000,
    maxExpandedLength: 5_000_000,
  },
});

function extractFeedEntries(xml: string): FeedEntry[] {
  const tree = feedParser.parse(xml) as unknown;
  const entries = collectByName(tree, 'entry').concat(
    collectByName(tree, 'item'),
  );
  return entries.filter(isRecord).map(readEntry);
}

function readEntry(entry: Record<string, unknown>): FeedEntry {
  const content = firstText(
    entry.content,
    entry.summary,
    entry.description,
    entry['content:encoded'],
  );
  const embeddedCap =
    content && looksLikeCap(unescapeXml(content))
      ? unescapeXml(content)
      : undefined;

  return {
    embeddedCap,
    linkUrl: firstCapLink(entry),
  };
}

function firstCapLink(entry: Record<string, unknown>): string | undefined {
  const links = asArray(entry.link);
  for (const link of links) {
    if (typeof link === 'string' && isHttpUrl(link)) return link;
    if (!isRecord(link)) continue;
    const href = textOf(link['@_href']) ?? textOf(link.href);
    if (!href || !isHttpUrl(href)) continue;
    const rel = (textOf(link['@_rel']) ?? 'alternate').toLowerCase();
    const type = (textOf(link['@_type']) ?? '').toLowerCase();
    if (
      type.includes('cap') ||
      type.includes('xml') ||
      rel === 'alternate' ||
      rel === 'enclosure'
    ) {
      return href;
    }
  }

  const id = textOf(entry.id);
  if (id && isHttpUrl(id)) return id;
  return undefined;
}

function collectByName(node: unknown, name: string): unknown[] {
  if (Array.isArray(node)) {
    return node.flatMap((item) => collectByName(item, name));
  }
  if (!isRecord(node)) return [];
  const found: unknown[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === name) found.push(...asArray(value));
    else found.push(...collectByName(value, name));
  }
  return found;
}

function looksLikeFeed(body: string, contentType: string): boolean {
  const type = contentType.toLowerCase();
  if (type.includes('atom') || type.includes('rss')) return true;
  const trimmed = body.trim();
  return (
    /<(?:\w+:)?feed[\s>]/i.test(trimmed) || /<(?:\w+:)?rss[\s>]/i.test(trimmed)
  );
}

function looksLikeCap(body: string): boolean {
  const trimmed = body.trim();
  return (
    (/<(?:\w+:)?alert[\s>]/i.test(trimmed) ||
      trimmed.includes('urn:oasis:names:tc:emergency:cap:')) &&
    /<\/(?:\w+:)?alert>/i.test(trimmed)
  );
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = textOf(value);
    if (text) return text;
    if (isRecord(value)) {
      const nested = textOf(value['#text']);
      if (nested) return nested;
    }
  }
  return undefined;
}

function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function headerValue(response: Response, name: string): string | undefined {
  const value = response.headers.get(name);
  return value && value.trim() ? value.trim() : undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function asArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
