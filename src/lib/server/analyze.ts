// src/lib/server/analyze.ts
// Letter analysis with Gemma 4 running locally in Ollama.
// The image never leaves the laptop: Ollama runs on localhost.

import * as env from '$app/env/private';

export type Lang = 'de' | 'en';

const OLLAMA_URL = env.OLLAMA_URL ?? 'http://localhost:11434';
// gemma4:26b = 26B MoE, ~4B active -> fast. Try gemma4:31b if OCR quality is lacking.
const MODEL = env.GEMMA_MODEL ?? 'gemma4:26b';

// ---------- Output contract (shared with the UI) ----------

export type ActionType = 'call' | 'pay' | 'send_document' | 'reply' | 'appointment' | 'other';

export interface ActionItem {
	title: string;
	type: ActionType;
	due: string | null; // YYYY-MM-DD
	details: string;
	phone: string | null; // E.164 after normalize(), e.g. +496211234567
	phone_raw: string | null; // as printed on the letter, for the confirm dialog
	call_purpose_de: string | null; // one German sentence for the phone agent
}

export interface Analysis {
	document_type: string;
	sender: { name: string; type: 'authority' | 'company' | 'private' | 'other'; phone: string | null; email: string | null };
	letter_date: string | null;
	references: { label: string; value: string }[];
	summary: string;
	urgency: 'low' | 'medium' | 'high';
	deadline: string | null;
	deadline_is_estimate: boolean;
	amount_due: string | null;
	action_items: ActionItem[];
	// For the knowledge graph + search:
	keywords: string[]; // 3–8 search terms in BOTH German and English
	entities: { type: 'person' | 'organization' | 'topic'; name: string }[]; // mentioned besides the sender
}

// JSON schema passed to Ollama's `format` -> constrained decoding, always valid JSON.
// Missing values are "" (simpler for the grammar than nullable types); normalize() turns them into null.
const str = { type: 'string' };
export const analysisSchema = {
	type: 'object',
	properties: {
		document_type: str,
		sender: {
			type: 'object',
			properties: {
				name: str,
				type: { type: 'string', enum: ['authority', 'company', 'private', 'other'] },
				phone: str,
				email: str
			},
			required: ['name', 'type', 'phone', 'email']
		},
		letter_date: str,
		references: {
			type: 'array',
			items: { type: 'object', properties: { label: str, value: str }, required: ['label', 'value'] }
		},
		summary: str,
		urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
		deadline: str,
		deadline_is_estimate: { type: 'boolean' },
		amount_due: str,
		action_items: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					title: str,
					type: { type: 'string', enum: ['call', 'pay', 'send_document', 'reply', 'appointment', 'other'] },
					due: str,
					details: str,
					phone: str,
					call_purpose_de: str
				},
				required: ['title', 'type', 'due', 'details', 'phone', 'call_purpose_de']
			}
		},
		keywords: { type: 'array', items: str },
		entities: {
			type: 'array',
			items: {
				type: 'object',
				properties: { type: { type: 'string', enum: ['person', 'organization', 'topic'] }, name: str },
				required: ['type', 'name']
			}
		}
	},
	required: [
		'document_type', 'sender', 'letter_date', 'references', 'summary', 'urgency',
		'deadline', 'deadline_is_estimate', 'amount_due', 'action_items', 'keywords', 'entities'
	]
} as const;

// ---------- Prompt ----------

function systemPrompt(lang: Lang, today: string): string {
	const language = lang === 'de' ? 'German' : 'English';
	return `You read photos of letters (German authorities, tax office, health insurance, landlords, banks, employers, companies) and explain them to the person who received them.

Today is ${today}.

Write ALL free-text fields (document_type, summary, title, details) in ${language}, in plain, friendly language that a non-expert understands. When a German legal term matters (e.g. "Widerspruch", "Aktenzeichen", "Mahnung"), keep it in parentheses after your explanation.

Rules:
- Use only information visible in the letter. NEVER invent phone numbers, emails, dates, amounts or reference numbers. If something is missing, use "".
- Dates are YYYY-MM-DD.
- letter_date: the date printed on the letter.
- deadline: the most important deadline. If it is relative (e.g. "innerhalb eines Monats nach Bekanntgabe"), estimate it from letter_date assuming delivery 4 days after the letter date, and set deadline_is_estimate to true. Otherwise false.
- references: every reference/customer/file number with its printed label (Aktenzeichen, Steuernummer, Kundennummer, Versicherungsnummer, Rechnungsnummer ...).
- amount_due: amount and currency as printed (e.g. "312,40 EUR"), or "".
- summary: 2-4 sentences. What is this letter, what does it mean for me, what happens if I do nothing.
- urgency: "high" if a deadline is within 14 days of today, or it is a payment reminder (Mahnung), enforcement, court or cancellation matter; "medium" if action is needed later; "low" if purely informational.
- action_items: concrete next steps, most important first, at most 5. Each with due date if known.
  - Use type "call" only if the letter gives a phone number AND calling helps (questions, clarification, appointment, objection discussion). Put the number in phone exactly as printed.
  - For type "call", write call_purpose_de: ONE short German sentence describing why we call, e.g. "Rückfrage zum Steuerbescheid 2025 und zur Nachzahlung." Otherwise "".
- sender.phone: the main phone/service number printed on the letter, exactly as printed, or "".
- keywords: 3-8 short search terms, each in German AND English (e.g. "Steuerbescheid", "tax assessment", "Nachzahlung", "back payment").
- entities: other persons, organizations and topics the letter is about, besides the sender (e.g. the case worker, an employer, a landlord, "Einkommensteuer 2025", "Kfz-Versicherung"). At most 8. Short canonical names.`;
}

// ---------- Normalization ----------

/** "0621 / 123 45-0", "+49 (0)621 12345", "0049621..." -> "+4962112345..." (assumes Germany for national numbers). */
export function toE164(raw: string, defaultCountry = '49'): string | null {
	if (!raw) return null;
	let s = raw.replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
	if (s.startsWith('00')) s = '+' + s.slice(2);
	else if (s.startsWith('0')) s = '+' + defaultCountry + s.slice(1);
	else if (!s.startsWith('+')) return null;
	return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
}

const nul = (s: string | undefined | null) => (s && s.trim() ? s.trim() : null);

function normalize(raw: any): Analysis {
	return {
		document_type: raw.document_type ?? '',
		sender: {
			name: raw.sender?.name ?? '',
			type: raw.sender?.type ?? 'other',
			phone: toE164(raw.sender?.phone ?? ''),
			email: nul(raw.sender?.email)
		},
		letter_date: nul(raw.letter_date),
		references: (raw.references ?? []).filter((r: any) => r.value?.trim()),
		summary: raw.summary ?? '',
		urgency: raw.urgency ?? 'medium',
		deadline: nul(raw.deadline),
		deadline_is_estimate: !!raw.deadline_is_estimate,
		amount_due: nul(raw.amount_due),
		action_items: (raw.action_items ?? []).slice(0, 5).map((a: any) => {
			// Fall back to the sender's number for call items without their own number.
			const phoneRaw = nul(a.phone) ?? (a.type === 'call' ? nul(raw.sender?.phone) : null);
			return {
				title: a.title ?? '',
				type: a.type ?? 'other',
				due: nul(a.due),
				details: a.details ?? '',
				phone: phoneRaw ? toE164(phoneRaw) : null,
				phone_raw: phoneRaw,
				call_purpose_de: nul(a.call_purpose_de)
			};
		}),
		keywords: (raw.keywords ?? []).map((k: string) => k.trim()).filter(Boolean).slice(0, 12),
		entities: (raw.entities ?? []).filter((e: any) => e.name?.trim()).slice(0, 8)
	};
}

// ---------- Ollama call ----------

/** imagesB64: plain base64 strings (no "data:image/...;base64," prefix), one per page. */
export async function analyzeLetter(imagesB64: string[], lang: Lang): Promise<Analysis> {
	const today = new Date().toISOString().slice(0, 10);
	const res = await fetch(`${OLLAMA_URL}/api/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: MODEL,
			stream: false,
			format: analysisSchema,
			think: false, // faster; set true if extraction quality on tricky letters is poor
			options: {
				temperature: 0,
				num_ctx: 16384 // Ollama's default context is small; images + schema need room
			},
			messages: [
				{ role: 'system', content: systemPrompt(lang, today) },
				{
					role: 'user',
					content: `Here ${imagesB64.length === 1 ? 'is the letter' : `are the ${imagesB64.length} pages of the letter`}. Analyze it.`,
					images: imagesB64
				}
			]
		})
	});

	if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
	const data = await res.json();
	return normalize(JSON.parse(data.message.content));
}
