#!/usr/bin/env node
/**
 * Strips comments from a JSONC file and writes strict JSON.
 *
 * The Locales repository is authored in JSONC because comments are how a
 * translator is told what a string is for and what its placeholders carry.
 * The message-format plugin reads strict JSON, so the comments come off here,
 * during the sync — which means the build never has to understand them and a
 * note can be as long as it needs to be without shipping to anyone's browser.
 *
 * Character by character rather than by regular expression: `//` and `/*`
 * appear inside real translated strings (a URL, a date format), and a regex
 * that does not track whether it is inside a string literal silently truncates
 * the file at the first one.
 *
 * `$schema` is dropped rather than kept. Upstream it is an editor hint on the
 * authored JSONC; here every key in the file is a message the bot can look up,
 * and a schema URL sitting among them would type as one.
 *
 * This is a near-copy of the same script in `trptools-frontend`. Copied rather
 * than shared: the two repositories install and deploy independently, and a
 * package to hold thirty lines of string handling would be a third release to
 * cut every time either changes.
 *
 * Usage: node scripts/jsonc-to-json.mjs <in.jsonc> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);

if (!input || !output) {
	console.error('usage: jsonc-to-json.mjs <in.jsonc> <out.json>');
	process.exit(2);
}

export function stripComments(source) {
	let out = '';
	let i = 0;

	while (i < source.length) {
		const char = source[i];

		if (char === '"') {
			// Copy the whole string literal verbatim, escapes included, so
			// nothing inside it is ever mistaken for a comment.
			out += char;
			i++;
			while (i < source.length) {
				out += source[i];
				if (source[i] === '\\') {
					out += source[i + 1] ?? '';
					i += 2;
					continue;
				}
				if (source[i] === '"') {
					i++;
					break;
				}
				i++;
			}
			continue;
		}

		if (char === '/' && source[i + 1] === '/') {
			while (i < source.length && source[i] !== '\n') i++;
			continue;
		}

		if (char === '/' && source[i + 1] === '*') {
			i += 2;
			while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
			i += 2;
			continue;
		}

		out += char;
		i++;
	}

	// A trailing comma is legal in JSONC and is the likeliest thing to survive
	// a hand edit, so it is forgiven rather than made someone's problem.
	return out.replace(/,(\s*[}\]])/g, '$1');
}

let parsed;
try {
	parsed = JSON.parse(stripComments(readFileSync(input, 'utf8')));
} catch (error) {
	console.error(`${input}: not valid JSONC — ${error.message}`);
	process.exit(1);
}

if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
	console.error(`${input}: expected an object of messages.`);
	process.exit(1);
}

const { $schema: _ignored, ...messages } = parsed;

writeFileSync(output, JSON.stringify(messages, null, '\t') + '\n');
