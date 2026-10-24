import type { GraphData, GraphNode, NodeKind } from '#lib/types.ts';

export const nodeColors: Record<NodeKind, string> = {
  document: 'var(--color-primary)', organization: 'var(--color-secondary)', reference: 'var(--color-on-tertiary-container)', person: 'var(--color-surface-tint)', topic: 'var(--color-on-tertiary-fixed-variant)'
};

export function linkedDocuments(data: GraphData, node: GraphNode): GraphNode[] {
  const ids = new Set(data.links.filter(link => link.source === node.id || link.target === node.id).map(link => link.source === node.id ? link.target : link.source));
  return data.nodes.filter(candidate => candidate.kind === 'document' && ids.has(candidate.id));
}

export function documentId(node: GraphNode): string | null {
  return node.kind === 'document' && node.id.startsWith('doc:') ? node.id.slice(4) : null;
}
