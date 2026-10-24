import type { Analysis } from '#lib/server/analyze.ts';
import type { DocumentRow } from '#lib/server/db.ts';
export type { Analysis, ActionItem, Payment } from '#lib/server/analyze.ts';
export type { CallEvent, CallState } from '#lib/server/calls.ts';
export type { DocumentRow } from '#lib/server/db.ts';

export interface RelatedDocument {
  id: string;
  document_type: string;
  sender_name: string;
  letter_date: string | null;
  urgency: string;
  score: number;
  shared: string;
}
export type DocumentDetail = DocumentRow & { analysis: Analysis; related: RelatedDocument[]; case: { id: string; title: string; status: 'open' | 'closed' } | null };
export interface AnalyzeResponse { id: string; case_id: string; case_created: boolean; analysis: Analysis; related: RelatedDocument[] }
export type NodeKind = 'document' | 'organization' | 'reference' | 'person' | 'topic';
export type GraphNodeKind = NodeKind | 'case';
export interface GraphNode { id: string; kind: GraphNodeKind; label: string; urgency?: string; degree?: number; status?: 'open' | 'closed' }
export interface GraphLink { source: string; target: string; role: string }
export interface GraphData { nodes: GraphNode[]; links: GraphLink[] }
