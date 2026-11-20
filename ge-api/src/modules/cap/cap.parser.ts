import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import {
  ALERT_CATEGORIES,
  ALERT_CERTAINTIES,
  ALERT_MSG_TYPES,
  ALERT_SEVERITIES,
  ALERT_TIERS,
  ALERT_URGENCIES,
  type AlertArea,
  type AlertCategory,
  type AlertCertainty,
  type AlertSeverity,
  type AlertTier,
  type AlertUrgency,
  type NormalizedAlert,
  buildAlertId,
} from '../../common/models/normalize-alert.model';

const MAX_CAP_CHARS = 5_000_000;
const EARTH_RADIUS_KM = 6371;
const CIRCLE_STEPS = 64;

export class CapParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapParseError';
  }
}

export interface ParseCapOptions {
  source: string;
  tier: AlertTier;
  sourceUrl?: string;
  /** Preferred BCP-47 language when an alert has several info blocks. */
  lang?: string;
}

interface InfoFields {
  category: AlertCategory;
  event: string;
  urgency: AlertUrgency;
  severity: AlertSeverity;
  certainty: AlertCertainty;
  effective?: Date;
  expires?: Date;
  headline?: string;
  description?: string;
  instruction?: string;
  web?: string;
  lang: string;
  areas: AlertArea[];
}

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  ignoreDeclaration: true,
  removeNSPrefix: true,
  trimValues: true,
  // Keep identifiers and SAME codes as strings ("012087" must not become 12087).
  parseTagValue: false,
  parseAttributeValue: false,
  // Predefined entities (&amp;, &lt;, ...) still decode. Custom entities are
  // capped, and a DOCTYPE is rejected before parse so external entities
  // are never declared.
  processEntities: {
    enabled: true,
    maxEntityCount: 0,
    maxEntitySize: 0,
    maxExpansionDepth: 1,
    maxTotalExpansions: 100_000,
    maxExpandedLength: MAX_CAP_CHARS,
  },
  htmlEntities: false,
});

export function parseCapDocument(
  xml: string,
  options: ParseCapOptions,
): NormalizedAlert[] {
  if (!options.source.trim()) {
    throw new CapParseError('A source key is required');
  }
  if (!isOneOf(options.tier, ALERT_TIERS)) {
    throw new CapParseError('A source tier is required');
  }

  const nodes = collectAlertNodes(readXmlTree(xml), 0);
  if (nodes.length === 0) {
    throw new CapParseError('No CAP alert found');
  }

  const alerts: NormalizedAlert[] = [];
  for (const node of nodes) {
    const alert = toNormalizedAlert(node, options);
    if (alert) alerts.push(alert);
  }
  return alerts;
}

function readXmlTree(xml: string): unknown {
  const document = xml.replace(/^\uFEFF/, '').trim();
  if (!document) throw new CapParseError('CAP document is empty');
  assertSafeXml(document);
  const validation = XMLValidator.validate(document);
  if (validation !== true) {
    throw new CapParseError('CAP document is not valid XML');
  }
  try {
    return xmlParser.parse(document) as unknown;
  } catch {
    throw new CapParseError('CAP document is not valid XML');
  }
}

function assertSafeXml(xml: string): void {
  if (xml.includes('\0')) {
    throw new CapParseError('CAP document contains a null byte');
  }
  if (xml.length > MAX_CAP_CHARS) {
    throw new CapParseError('CAP document exceeds the 5MB limit');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new CapParseError(
      'CAP documents must not declare a DOCTYPE or entities',
    );
  }
}

function collectAlertNodes(
  node: unknown,
  depth: number,
): Record<string, unknown>[] {
  if (depth > 40) {
    throw new CapParseError('CAP document is too deeply nested');
  }
  if (typeof node === 'string') {
    if (!looksLikeEmbeddedCap(node)) return [];
    return collectAlertNodes(readXmlTree(node), depth + 1);
  }
  if (Array.isArray(node)) {
    return node.flatMap((item) => collectAlertNodes(item, depth + 1));
  }
  if (!isRecord(node)) return [];
  if (isAlertNode(node)) return [node];

  const found: Record<string, unknown>[] = [];
  for (const value of Object.values(node)) {
    found.push(...collectAlertNodes(value, depth + 1));
    if (found.length > 1000) {
      throw new CapParseError('CAP document contains too many alerts');
    }
  }
  return found;
}

function looksLikeEmbeddedCap(value: string): boolean {
  const trimmed = value.trim();
  return (
    (trimmed.startsWith('<?xml') ||
      trimmed.startsWith('<alert') ||
      trimmed.startsWith('<cap:alert')) &&
    trimmed.includes('</alert>')
  );
}

function isAlertNode(value: Record<string, unknown>): boolean {
  return (
    'identifier' in value &&
    'sender' in value &&
    'sent' in value &&
    'msgType' in value
  );
}

function toNormalizedAlert(
  node: Record<string, unknown>,
  options: ParseCapOptions,
): NormalizedAlert | null {
  const msgTypeRaw = textOf(node.msgType);
  if (msgTypeRaw === 'Ack' || msgTypeRaw === 'Error') return null;
  if (!isOneOf(msgTypeRaw, ALERT_MSG_TYPES)) {
    throw new CapParseError('CAP msgType is invalid');
  }

  const sender = textOf(node.sender);
  const identifier = textOf(node.identifier);
  const sentRaw = textOf(node.sent);
  if (!sender || !identifier || !sentRaw) {
    throw new CapParseError('CAP alert is missing sender, identifier, or sent');
  }
  if (sender.includes('|') || identifier.includes('|')) {
    throw new CapParseError('CAP sender and identifier must not contain "|"');
  }

  const sent = parseCapDate(sentRaw, 'sent');
  const infos = asArray(node.info).filter(isRecord);
  const info = selectInfo(infos, options.lang);
  if (!info && msgTypeRaw !== 'Cancel') {
    throw new CapParseError('CAP alert is missing info');
  }
  const fields = info ? readInfo(info) : emptyInfo();
  const sourceUrl = httpUrl(fields.web) ?? httpUrl(options.sourceUrl);
  const references = parseReferences(textOf(node.references));

  const alert: NormalizedAlert = {
    id: buildAlertId(sender, identifier, sent),
    source: options.source,
    sender,
    msgType: msgTypeRaw,
    category: fields.category,
    event: fields.event,
    urgency: fields.urgency,
    severity: fields.severity,
    certainty: fields.certainty,
    sent,
    areas: fields.areas,
    lang: fields.lang,
    tier: options.tier,
    raw: stripNulls(node),
  };
  if (references) alert.references = references;
  if (fields.effective) alert.effective = fields.effective;
  if (fields.expires) alert.expires = fields.expires;
  if (fields.headline) alert.headline = fields.headline;
  if (fields.description) alert.description = fields.description;
  if (fields.instruction) alert.instruction = fields.instruction;
  if (sourceUrl) alert.sourceUrl = sourceUrl;
  return alert;
}

function selectInfo(
  infos: Record<string, unknown>[],
  preferred?: string,
): Record<string, unknown> | undefined {
  if (infos.length === 0) return undefined;
  if (!preferred) return infos[0];
  return (
    infos.find((info) => langMatches(textOf(info.language), preferred)) ??
    infos[0]
  );
}

function langMatches(language: string | undefined, preferred: string): boolean {
  if (!language) return false;
  const value = language.toLowerCase();
  const want = preferred.toLowerCase();
  return value === want || value.startsWith(`${want}-`);
}

function readInfo(info: Record<string, unknown>): InfoFields {
  const category = textOf(asArray(info.category)[0]);
  if (!isOneOf(category, ALERT_CATEGORIES)) {
    throw new CapParseError('CAP info has an invalid category');
  }
  const event = textOf(info.event);
  if (!event) throw new CapParseError('CAP info is missing event');

  const urgency = textOf(info.urgency);
  const severity = textOf(info.severity);
  const certainty = textOf(info.certainty);
  if (!isOneOf(urgency, ALERT_URGENCIES)) {
    throw new CapParseError('CAP info has an invalid urgency');
  }
  if (!isOneOf(severity, ALERT_SEVERITIES)) {
    throw new CapParseError('CAP info has an invalid severity');
  }
  if (!isOneOf(certainty, ALERT_CERTAINTIES)) {
    throw new CapParseError('CAP info has an invalid certainty');
  }

  return {
    category,
    event,
    urgency,
    severity,
    certainty,
    effective: optionalDate(info.effective, 'effective'),
    expires: optionalDate(info.expires, 'expires'),
    headline: textOf(info.headline),
    description: textOf(info.description),
    instruction: textOf(info.instruction),
    web: textOf(info.web),
    lang: textOf(info.language) ?? 'en-US',
    areas: asArray(info.area).map(readArea),
  };
}

function emptyInfo(): InfoFields {
  return {
    category: 'Other',
    event: 'Unknown',
    urgency: 'Unknown',
    severity: 'Unknown',
    certainty: 'Unknown',
    lang: 'en-US',
    areas: [],
  };
}

function readArea(value: unknown): AlertArea {
  if (!isRecord(value)) throw new CapParseError('CAP area is invalid');
  const name = textOf(value.areaDesc);
  if (!name) throw new CapParseError('CAP area is missing areaDesc');

  const area: AlertArea = { name };
  const geometry = readGeometry(value);
  const geocodes = readGeocodes(value);
  if (geometry) area.geometry = geometry;
  if (geocodes) area.geocodes = geocodes;
  return area;
}

/**
 * CAP polygons and circles are "lat,lon". GeoJSON is [lon, lat].
 * Several shapes in one area become a MultiPolygon (CAP has no holes).
 */
function readGeometry(
  area: Record<string, unknown>,
): Polygon | MultiPolygon | undefined {
  const polygons: Polygon[] = [];
  for (const raw of asArray(area.polygon)) {
    const text = textOf(raw);
    if (text) polygons.push(parseCapPolygon(text));
  }
  for (const raw of asArray(area.circle)) {
    const text = textOf(raw);
    if (text) polygons.push(parseCapCircle(text));
  }
  if (polygons.length === 0) return undefined;
  if (polygons.length === 1) return polygons[0];
  return {
    type: 'MultiPolygon',
    coordinates: polygons.map((polygon) => polygon.coordinates),
  };
}

function parseCapPolygon(value: string): Polygon {
  const ring: Position[] = value
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(pair);
      if (!match) {
        throw new CapParseError('CAP polygon has an invalid coordinate pair');
      }
      const lat = Number(match[1]);
      const lon = Number(match[2]);
      assertLatLon(lat, lon);
      return [lon, lat];
    });
  if (ring.length < 3) {
    throw new CapParseError('CAP polygon needs at least 3 points');
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  if (ring.length < 4) {
    throw new CapParseError('CAP polygon needs at least 3 points');
  }
  return { type: 'Polygon', coordinates: [ring] };
}

function parseCapCircle(value: string): Polygon {
  const match =
    /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/.exec(
      value.trim(),
    );
  if (!match) throw new CapParseError('CAP circle has an invalid shape');
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  const radiusKm = Number(match[3]);
  assertLatLon(lat, lon);
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 20000) {
    throw new CapParseError('CAP circle radius is invalid');
  }
  return circleToPolygon(lat, lon, radiusKm);
}

function circleToPolygon(lat: number, lon: number, radiusKm: number): Polygon {
  const angular = radiusKm / EARTH_RADIUS_KM;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const ring: Position[] = [];
  for (let step = 0; step <= CIRCLE_STEPS; step++) {
    const bearing = (2 * Math.PI * step) / CIRCLE_STEPS;
    const lat2 = Math.asin(
      Math.sin(latRad) * Math.cos(angular) +
        Math.cos(latRad) * Math.sin(angular) * Math.cos(bearing),
    );
    const lon2 =
      lonRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(latRad),
        Math.cos(angular) - Math.sin(latRad) * Math.sin(lat2),
      );
    ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  ring[ring.length - 1] = [ring[0][0], ring[0][1]];
  return { type: 'Polygon', coordinates: [ring] };
}

function readGeocodes(
  area: Record<string, unknown>,
): Record<string, string> | undefined {
  const codes: Record<string, string> = {};
  for (const entry of asArray(area.geocode)) {
    if (!isRecord(entry)) continue;
    const name = textOf(entry.valueName);
    const value = textOf(entry.value);
    if (!name || !value) continue;
    codes[name] = codes[name] ? `${codes[name]},${value}` : value;
  }
  return Object.keys(codes).length > 0 ? codes : undefined;
}

function parseReferences(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const refs: string[] = [];
  for (const token of value.split(/\s+/)) {
    if (!token) continue;
    const parts = token.split(',');
    if (parts.length < 3) {
      throw new CapParseError('CAP references entry is invalid');
    }
    const sentRaw = parts[parts.length - 1];
    const identifier = parts[parts.length - 2];
    const sender = parts.slice(0, -2).join(',');
    if (!sender || !identifier) {
      throw new CapParseError('CAP references entry is invalid');
    }
    refs.push(
      buildAlertId(
        sender,
        identifier,
        parseCapDate(sentRaw, 'references sent'),
      ),
    );
  }
  return refs.length > 0 ? refs : undefined;
}

function optionalDate(value: unknown, field: string): Date | undefined {
  const text = textOf(value);
  return text ? parseCapDate(text, field) : undefined;
}

function parseCapDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new CapParseError(`CAP ${field} is not a valid date`);
  }
  return date;
}

function assertLatLon(lat: number, lon: number): void {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    throw new CapParseError(
      'CAP area has a coordinate outside the valid range',
    );
  }
}

function httpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function textOf(value: unknown): string | undefined {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return cleanText(String(value));
  }
  if (typeof value !== 'string') return undefined;
  return cleanText(value);
}

function cleanText(value: string): string | undefined {
  let cleaned = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    const isControl =
      code === 0 ||
      code === 127 ||
      (code < 32 && code !== 9 && code !== 10 && code !== 13);
    if (!isControl) cleaned += char;
  }
  const trimmed = cleaned.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stripNulls(value: unknown): unknown {
  if (typeof value === 'string') return value.split('\u0000').join('');
  if (Array.isArray(value)) return value.map(stripNulls);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = stripNulls(entry);
  }
  return out;
}

function asArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): value is T {
  return value !== undefined && (allowed as readonly string[]).includes(value);
}
