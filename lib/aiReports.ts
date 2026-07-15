// lib/aiReports.ts
// ─────────────────────────────────────────────────────────
// Reportes de contenido de IA (política "AI-Generated Content" de
// Google Play): el usuario marca una respuesta de la IA como
// incorrecta, dañina u ofensiva. No modera en el momento — solo deja
// el reporte auditable en ai_content_reports para revisión posterior.
// ─────────────────────────────────────────────────────────

import { supabase } from './supabase';

export type AIReportFeature = 'coach_chat' | 'posture' | 'body_scan' | 'food_scan' | 'fridge_scan';
export type AIReportReason = 'incorrect' | 'harmful' | 'offensive' | 'other';

export const AI_REPORT_REASONS: { id: AIReportReason; label: string }[] = [
  { id: 'incorrect', label: 'La información es incorrecta' },
  { id: 'harmful', label: 'El consejo puede ser dañino o inseguro' },
  { id: 'offensive', label: 'El tono es ofensivo o inapropiado' },
  { id: 'other', label: 'Otro motivo' },
];

const CONTENT_SNAPSHOT_MAX = 2000;

export async function reportAIContent(params: {
  userId: string;
  feature: AIReportFeature;
  reason: AIReportReason;
  note?: string;
  content?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('ai_content_reports').insert({
    user_id: params.userId,
    feature: params.feature,
    reason: params.reason,
    note: params.note?.trim() || null,
    content_snapshot: params.content ? params.content.slice(0, CONTENT_SNAPSHOT_MAX) : null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
