// Small helper: turn CaseError into a 400 instead of a 500.
import { error } from '@sveltejs/kit';
import { CaseError } from './cases.ts';

export function guard<T>(fn: () => T): T {
	try {
		return fn();
	} catch (e) {
		if (e instanceof CaseError) error(400, e.message);
		throw e;
	}
}
