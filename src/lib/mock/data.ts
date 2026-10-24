import sample from './analysis.json' with { type: 'json' };
import type { Analysis, DocumentDetail, DocumentRow, GraphData } from '#lib/types.ts';

export const mockAnalysis = sample as Analysis;
export const mockDocuments: DocumentDetail[] = [
  { id: 'demo-tax', created_at: '2026-10-12T10:30:00Z', page_count: 2, document_type: sample.document_type, sender_name: sample.sender.name, letter_date: sample.letter_date, deadline: sample.deadline, urgency: sample.urgency, summary: sample.summary, analysis: mockAnalysis,
    related: [{ id: 'demo-prior', document_type: 'Vorbescheid zur Einkommensteuer 2025', sender_name: sample.sender.name, letter_date: '2026-09-03', urgency: 'low', score: 5, shared: 'Steuernummer: 37 012 345 67 · Finanzamt Mannheim-Stadt' }] },
  { id: 'demo-rent', created_at: '2026-09-28T09:00:00Z', page_count: 1, document_type: 'Betriebskostenabrechnung 2025', sender_name: 'Hausverwaltung Müller', letter_date: '2026-09-28', deadline: null, urgency: 'low', summary: 'Die Betriebskostenabrechnung weist ein Guthaben von 148,00 EUR aus. Die Hausverwaltung überweist es auf Ihr hinterlegtes Konto.', related: [],
    analysis: { ...mockAnalysis, document_type: 'Betriebskostenabrechnung 2025', sender: { name: 'Hausverwaltung Müller', type: 'company', phone: null, email: null }, letter_date: '2026-09-28', deadline: null, urgency: 'low', amount_due: null, action_items: [], summary: 'Ihre Vorauszahlungen waren höher als die tatsächlichen Betriebskosten. Sie erhalten 148,00 EUR zurück; laut Schreiben erfolgt die Erstattung automatisch. Bewahren Sie die Abrechnung auf.', references: [{ label: 'Mieternummer', value: 'M-2048' }], keywords: ['Nebenkosten', 'utilities', 'Miete', 'rent'], entities: [{ type: 'topic', name: 'Betriebskosten 2025' }] } },
  { id: 'demo-health', created_at: '2026-09-15T09:00:00Z', page_count: 1, document_type: 'Beitragsanpassung Zusatzbeitrag 2027', sender_name: 'AOK Baden-Württemberg', letter_date: '2026-09-15', deadline: null, urgency: 'low', summary: 'Ihre Krankenkasse informiert über eine Anpassung des Zusatzbeitrags ab Januar 2027.', related: [],
    analysis: { ...mockAnalysis, document_type: 'Beitragsanpassung Zusatzbeitrag 2027', sender: { name: 'AOK Baden-Württemberg', type: 'company', phone: null, email: null }, letter_date: '2026-09-15', deadline: null, urgency: 'low', amount_due: null, action_items: [], summary: 'Der Zusatzbeitrag Ihrer Krankenkasse ändert sich zum 01.01.2027. Die Beiträge werden automatisch angepasst. Prüfen Sie die Informationen zum Sonderkündigungsrecht im Original.', references: [{ label: 'Versichertennummer', value: 'A123456789' }], keywords: ['Krankenkasse', 'health insurance', 'Zusatzbeitrag', 'contribution'], entities: [{ type: 'topic', name: 'Krankenversicherung' }] } },
  { id: 'demo-prior', created_at: '2026-09-03T09:00:00Z', page_count: 1, document_type: 'Vorbescheid zur Einkommensteuer 2025', sender_name: sample.sender.name, letter_date: '2026-09-03', deadline: null, urgency: 'low', summary: 'Das Finanzamt bestätigt den Eingang Ihrer Steuererklärung.', related: [],
    analysis: { ...mockAnalysis, document_type: 'Vorbescheid zur Einkommensteuer 2025', letter_date: '2026-09-03', deadline: null, urgency: 'low', amount_due: null, action_items: [], summary: 'Ihre Steuererklärung für 2025 ist beim Finanzamt eingegangen. Der endgültige Bescheid folgt nach der Prüfung. Sie müssen zurzeit nichts unternehmen.' } }
];

export function mockRows(query = ''): DocumentRow[] {
  const q = query.toLowerCase().trim();
  return mockDocuments.filter(doc => !q || JSON.stringify(doc).toLowerCase().includes(q)).map(({ analysis: _analysis, related: _related, ...row }) => row);
}

export function mockGraph(): GraphData {
  const nodes: GraphData['nodes'] = mockDocuments.map(doc => ({ id: `doc:${doc.id}`, kind: 'document', label: doc.document_type, urgency: doc.urgency }));
  nodes.push({ id: 'node:tax', kind: 'organization', label: sample.sender.name, degree: 2 }, { id: 'node:ref', kind: 'reference', label: 'Steuernummer: 37 012 345 67', degree: 2 }, { id: 'node:rent', kind: 'organization', label: 'Hausverwaltung Müller', degree: 1 }, { id: 'node:health', kind: 'organization', label: 'AOK Baden-Württemberg', degree: 1 }, { id: 'node:topic', kind: 'topic', label: 'Einkommensteuer 2025', degree: 2 }, { id: 'node:person', kind: 'person', label: 'Sachbearbeiterin Müller', degree: 1 });
  return { nodes, links: [
    ...['demo-tax', 'demo-prior'].flatMap(id => [{ source: `doc:${id}`, target: 'node:tax', role: 'sender' }, { source: `doc:${id}`, target: 'node:ref', role: 'reference' }, { source: `doc:${id}`, target: 'node:topic', role: 'mentions' }]),
    { source: 'doc:demo-rent', target: 'node:rent', role: 'sender' }, { source: 'doc:demo-health', target: 'node:health', role: 'sender' }, { source: 'doc:demo-tax', target: 'node:person', role: 'mentions' }
  ] };
}
