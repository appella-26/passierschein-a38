import sample from './analysis.json' with { type: 'json' };
import englishSample from './analysis.en.json' with { type: 'json' };
import type { Analysis, DocumentDetail, DocumentRow, GraphData } from '#lib/types.ts';
import type { Language } from '#lib/i18n.ts';

export const mockAnalysis = sample as Analysis;
export const mockDocuments: DocumentDetail[] = [
  { id: 'demo-tax', case_id: null, case: null, created_at: '2026-10-12T10:30:00Z', page_count: 2, document_type: sample.document_type, sender_name: sample.sender.name, letter_date: sample.letter_date, deadline: sample.deadline, urgency: sample.urgency, summary: sample.summary, analysis: mockAnalysis,
    related: [{ id: 'demo-prior', document_type: 'Vorbescheid zur Einkommensteuer 2025', sender_name: sample.sender.name, letter_date: '2026-09-03', urgency: 'low', score: 5, shared: 'Steuernummer: 37 012 345 67 · Finanzamt Mannheim-Stadt' }] },
  { id: 'demo-rent', case_id: null, case: null, created_at: '2026-09-28T09:00:00Z', page_count: 1, document_type: 'Betriebskostenabrechnung 2025', sender_name: 'Hausverwaltung Müller', letter_date: '2026-09-28', deadline: null, urgency: 'low', summary: 'Die Betriebskostenabrechnung weist ein Guthaben von 148,00 EUR aus. Die Hausverwaltung überweist es auf Ihr hinterlegtes Konto.', related: [],
    analysis: { ...mockAnalysis, case_title: 'Betriebskosten 2025', document_type: 'Betriebskostenabrechnung 2025', sender: { name: 'Hausverwaltung Müller', type: 'company', phone: null, email: null }, letter_date: '2026-09-28', deadline: null, urgency: 'low', amount_due: null, action_items: [], summary: 'Ihre Vorauszahlungen waren höher als die tatsächlichen Betriebskosten. Sie erhalten 148,00 EUR zurück; laut Schreiben erfolgt die Erstattung automatisch. Bewahren Sie die Abrechnung auf.', references: [{ label: 'Mieternummer', value: 'M-2048' }], keywords: ['Nebenkosten', 'utilities', 'Miete', 'rent'], entities: [{ type: 'topic', name: 'Betriebskosten 2025' }] } },
  { id: 'demo-health', case_id: null, case: null, created_at: '2026-09-15T09:00:00Z', page_count: 1, document_type: 'Beitragsanpassung Zusatzbeitrag 2027', sender_name: 'AOK Baden-Württemberg', letter_date: '2026-09-15', deadline: null, urgency: 'low', summary: 'Ihre Krankenkasse informiert über eine Anpassung des Zusatzbeitrags ab Januar 2027.', related: [],
    analysis: { ...mockAnalysis, case_title: 'Krankenkasse Beitrag 2027', document_type: 'Beitragsanpassung Zusatzbeitrag 2027', sender: { name: 'AOK Baden-Württemberg', type: 'company', phone: null, email: null }, letter_date: '2026-09-15', deadline: null, urgency: 'low', amount_due: null, action_items: [], summary: 'Der Zusatzbeitrag Ihrer Krankenkasse ändert sich zum 01.01.2027. Die Beiträge werden automatisch angepasst. Prüfen Sie die Informationen zum Sonderkündigungsrecht im Original.', references: [{ label: 'Versichertennummer', value: 'A123456789' }], keywords: ['Krankenkasse', 'health insurance', 'Zusatzbeitrag', 'contribution'], entities: [{ type: 'topic', name: 'Krankenversicherung' }] } },
  { id: 'demo-prior', case_id: null, case: null, created_at: '2026-09-03T09:00:00Z', page_count: 1, document_type: 'Vorbescheid zur Einkommensteuer 2025', sender_name: sample.sender.name, letter_date: '2026-09-03', deadline: null, urgency: 'low', summary: 'Das Finanzamt bestätigt den Eingang Ihrer Steuererklärung.', related: [],
    analysis: { ...mockAnalysis, document_type: 'Vorbescheid zur Einkommensteuer 2025', letter_date: '2026-09-03', deadline: null, urgency: 'low', amount_due: null, action_items: [], summary: 'Ihre Steuererklärung für 2025 ist beim Finanzamt eingegangen. Der endgültige Bescheid folgt nach der Prüfung. Sie müssen zurzeit nichts unternehmen.' } }
];

export const mockAnalysisEn = { ...mockAnalysis, ...englishSample } as Analysis;

const englishAnalyses: Record<string, Analysis> = {
  'demo-tax': mockAnalysisEn,
  'demo-rent': {
    ...mockDocuments[1].analysis,
    document_type: 'Service charge statement 2025',
    case_title: 'Rent & service charges 2025',
    summary: 'Good news: you paid more in advance than the building’s running costs came to. The property manager will refund €148.00 to your registered account automatically. Keep the statement for your records.',
    keywords: ['utilities', 'rent', 'Nebenkosten', 'Miete'],
    entities: [{ type: 'topic', name: 'Service charges 2025' }]
  },
  'demo-health': {
    ...mockDocuments[2].analysis,
    document_type: 'New health insurance rate for 2027',
    case_title: 'Health insurance contributions 2027',
    summary: 'Your health insurer is changing its additional contribution from 1 January 2027. The change will be applied automatically. Check the original letter for details of your right to switch insurers.',
    keywords: ['health insurance', 'contribution', 'Krankenkasse', 'Zusatzbeitrag'],
    entities: [{ type: 'topic', name: 'Health insurance' }]
  },
  'demo-prior': {
    ...mockDocuments[3].analysis,
    document_type: 'Tax return received · 2025',
    case_title: 'Income tax 2025',
    summary: 'Your 2025 tax return has reached the tax office. They’ll send the final assessment once they’ve checked it. For now, there’s nothing you need to do.',
    keywords: mockAnalysisEn.keywords,
    entities: mockAnalysisEn.entities
  }
};

const englishDocuments: DocumentDetail[] = mockDocuments.map(doc => {
  const analysis = englishAnalyses[doc.id] ?? doc.analysis;
  return {
    ...doc,
    document_type: analysis.document_type,
    summary: analysis.summary,
    analysis,
    related: doc.related.map(related => ({ ...related, document_type: englishAnalyses[related.id]?.document_type ?? related.document_type }))
  };
});

/** Only demo copy changes; identifiers, printed references and call purposes stay intact. */
export function getMockDocuments(lang: Language = 'en'): DocumentDetail[] {
  return lang === 'de' ? mockDocuments : englishDocuments;
}

export function mockRows(query = '', lang: Language = 'en'): DocumentRow[] {
  const q = query.toLowerCase().trim();
  return getMockDocuments(lang)
    .filter(doc => !q || JSON.stringify([doc, mockDocuments.find(original => original.id === doc.id)]).toLowerCase().includes(q))
    .map(({ analysis: _analysis, related: _related, case: _case, ...row }) => row);
}

export function mockGraph(lang: Language = 'en'): GraphData {
  const analysis = lang === 'de' ? mockAnalysis : mockAnalysisEn;
  const nodes: GraphData['nodes'] = getMockDocuments(lang).map(doc => ({ id: `doc:${doc.id}`, kind: 'document', label: doc.document_type, urgency: doc.urgency }));
  nodes.push({ id: 'node:tax', kind: 'organization', label: sample.sender.name, degree: 2 }, { id: 'node:ref', kind: 'reference', label: 'Steuernummer: 37 012 345 67', degree: 2 }, { id: 'node:rent', kind: 'organization', label: 'Hausverwaltung Müller', degree: 1 }, { id: 'node:health', kind: 'organization', label: 'AOK Baden-Württemberg', degree: 1 }, { id: 'node:topic', kind: 'topic', label: analysis.entities[0].name, degree: 2 }, { id: 'node:person', kind: 'person', label: analysis.entities[2].name, degree: 1 });
  return { nodes, links: [
    ...['demo-tax', 'demo-prior'].flatMap(id => [{ source: `doc:${id}`, target: 'node:tax', role: 'sender' }, { source: `doc:${id}`, target: 'node:ref', role: 'reference' }, { source: `doc:${id}`, target: 'node:topic', role: 'mentions' }]),
    { source: 'doc:demo-rent', target: 'node:rent', role: 'sender' }, { source: 'doc:demo-health', target: 'node:health', role: 'sender' }, { source: 'doc:demo-tax', target: 'node:person', role: 'mentions' }
  ] };
}
