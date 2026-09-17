import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { createHmac, timingSafeEqual } from 'crypto';
import { SettingsService } from '../settings/settings.service';

export interface DiditSession {
  sessionId: string;
  url: string;
  raw: any;
}

export interface DiditDecision {
  status: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  dateOfBirth?: string;
  documentType?: string;
  documentNumber?: string;
  issuingState?: string;
  faceMatchScore?: number;
  livenessScore?: number;
  amlHits?: number;
  declineReason?: string;
  raw: any;
}

/**
 * Didit identity verification client (https://docs.didit.me).
 *  create:   POST {api}/v2/session/   x-api-key
 *  decision: GET  {api}/v3/session/{id}/decision/
 *  webhook:  HMAC-SHA256 (X-Signature over raw body, X-Signature-V2 over canonical JSON), X-Timestamp ±5min
 */
@Injectable()
export class DiditService {
  private readonly logger = new Logger(DiditService.name);

  constructor(private readonly settings: SettingsService) {}

  async isConfigured() {
    const [key, wf] = await Promise.all([this.settings.get('didit.api_key'), this.settings.get('didit.workflow_id')]);
    return !!key && !!wf;
  }

  private async cfg() {
    const [api, key, wf, secret] = await Promise.all([
      this.settings.get('didit.api_url'),
      this.settings.get('didit.api_key'),
      this.settings.get('didit.workflow_id'),
      this.settings.get('didit.webhook_secret'),
    ]);
    return { api: api.replace(/\/+$/, ''), key, wf, secret };
  }

  async createSession(vendorData: string, callback: string, metadata?: Record<string, unknown>): Promise<DiditSession> {
    const { api, key, wf } = await this.cfg();
    const res = await axios.post(
      `${api}/v2/session/`,
      { workflow_id: wf, vendor_data: vendorData, callback, metadata },
      { headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, timeout: 20_000 },
    );
    const d = res.data || {};
    return { sessionId: d.session_id, url: d.url || d.session_url || d.verification_url, raw: d };
  }

  async getDecision(sessionId: string): Promise<DiditDecision> {
    const { api, key } = await this.cfg();
    let data: any;
    try {
      data = (await axios.get(`${api}/v3/session/${sessionId}/decision/`, { headers: { 'x-api-key': key }, timeout: 20_000 })).data;
    } catch (e) {
      const err = e as AxiosError;
      if (err.response?.status === 404) {
        data = (await axios.get(`${api}/v2/session/${sessionId}/decision/`, { headers: { 'x-api-key': key }, timeout: 20_000 })).data;
      } else throw e;
    }
    return DiditService.mapDecision(data);
  }

  static mapDecision(data: any): DiditDecision {
    const idv = data?.decision?.id_verifications?.[0] ?? data?.id_verifications?.[0] ?? data?.id_verification ?? data?.decision?.id_verification ?? {};
    const face = data?.decision?.face_matches?.[0] ?? data?.face_match ?? data?.decision?.face_match ?? {};
    const live = data?.decision?.liveness?.[0] ?? data?.liveness ?? data?.decision?.liveness ?? {};
    const aml = data?.decision?.aml?.[0] ?? data?.aml ?? data?.decision?.aml ?? {};
    return {
      status: data?.status ?? 'Unknown',
      firstName: idv.first_name,
      lastName: idv.last_name,
      fullName: idv.full_name ?? [idv.first_name, idv.last_name].filter(Boolean).join(' '),
      dateOfBirth: idv.date_of_birth,
      documentType: idv.document_type,
      documentNumber: idv.document_number,
      issuingState: idv.issuing_state ?? idv.issuing_state_name,
      faceMatchScore: typeof face.score === 'number' ? face.score : undefined,
      livenessScore: typeof live.score === 'number' ? live.score : undefined,
      amlHits: Array.isArray(aml.hits) ? aml.hits.length : typeof aml.total_hits === 'number' ? aml.total_hits : undefined,
      declineReason: data?.decision?.reason ?? idv.status_reason ?? data?.reason,
      raw: data,
    };
  }

  /** Canonical JSON used by X-Signature-V2: recursively sorted keys, compact separators, unicode preserved. */
  static canonicalJson(value: any): string {
    if (Array.isArray(value)) return `[${value.map((v) => DiditService.canonicalJson(v)).join(',')}]`;
    if (value && typeof value === 'object') {
      const keys = Object.keys(value).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${DiditService.canonicalJson(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  async verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<{ ok: boolean; reason?: string }> {
    const { secret } = await this.cfg();
    if (!secret) return { ok: false, reason: 'WEBHOOK_SECRET_NOT_CONFIGURED' };
    const h = (n: string) => {
      const v = headers[n] ?? headers[n.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    };
    const ts = Number(h('x-timestamp'));
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return { ok: false, reason: 'TIMESTAMP_OUT_OF_WINDOW' };

    const sigRaw = h('x-signature');
    const sigV2 = h('x-signature-v2');
    const candidates: Array<[string | undefined, string]> = [];
    if (sigRaw) candidates.push([sigRaw, createHmac('sha256', secret).update(rawBody).digest('hex')]);
    if (sigV2) {
      try {
        candidates.push([sigV2, createHmac('sha256', secret).update(DiditService.canonicalJson(JSON.parse(rawBody.toString('utf8')))).digest('hex')]);
      } catch {
        /* ignore */
      }
    }
    for (const [given, expected] of candidates) {
      if (!given) continue;
      const a = Buffer.from(given.trim().toLowerCase());
      const b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true };
    }
    return { ok: false, reason: candidates.length ? 'SIGNATURE_MISMATCH' : 'SIGNATURE_MISSING' };
  }
}
