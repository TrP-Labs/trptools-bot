#!/usr/bin/env bash
# Mirrors a Locales repository's bot catalogue into ./messages.
#
# The bot loads these at startup rather than compiling them in, but the output
# is still committed, for the same reasons the website commits its own: a build
# stays reproducible and does not depend on GitHub being reachable, and a
# wording change shows up as a reviewable diff in this repository's own pull
# request.
#
# English is authored as JSONC upstream so its comments can carry context for
# translators; every other language is written by Crowdin as plain JSON. Both
# go through the same stripper here — it is a no-op on a file with no comments,
# and it is also what refuses a malformed one.
#
# Adding a language is deliberately two steps. This script brings the file in;
# listing the locale in src/i18n/catalog.ts is what actually ships it, and that
# is a decision about whether a translation is complete enough to put in front
# of people.
#
# Usage: ./scripts/pull-locales.sh [owner/repo] [ref]
#   Defaults to TrP-Labs/Locales at prod. Point this at a fork to ship your
#   own wording instead.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

REPO="${1:-TrP-Labs/Locales}"
REF="${2:-prod}"
API="https://api.github.com/repos/$REPO/contents/locales?ref=$REF"

mkdir -p messages

listing=$(curl -fsSL -H 'Accept: application/vnd.github+json' "$API" 2>/dev/null) || {
	echo "error: could not list $REPO@$REF." >&2
	echo "Check the repository and branch exist and are public. Unauthenticated" >&2
	echo "GitHub API calls are also rate limited to 60/hour per address." >&2
	exit 1
}

# One directory per language, each holding a bot.json. Read into an array the
# long way rather than with `mapfile`, which macOS's bash 3.2 does not have —
# this is run on laptops as well as in CI.
locales=()
while IFS= read -r line; do
	[ -n "$line" ] && locales+=("$line")
done < <(printf '%s' "$listing" | python3 -c '
import json, sys, re
for item in json.load(sys.stdin):
    if item.get("type") != "dir":
        continue
    # A language tag and nothing else, so a stray directory cannot decide
    # where this script writes.
    if re.fullmatch(r"[a-z]{2}(-[A-Za-z0-9]{2,8})?", item["name"]):
        print(item["name"])
')

if [ "${#locales[@]}" -eq 0 ]; then
	echo "warning: $REPO@$REF holds no language directories under locales/." >&2
	exit 0
fi

pulled=()
for locale in "${locales[@]}"; do
	# bot.json first: that is what Crowdin writes, and for English it is the
	# generated twin of the .jsonc, so preferring it means one code path. The
	# .jsonc fallback is for a language being drafted by hand upstream, before
	# Crowdin has anything for it.
	found=""
	for name in bot.json bot.jsonc; do
		url="https://raw.githubusercontent.com/$REPO/$REF/locales/$locale/$name"
		if curl -fsSL "$url" -o "messages/$locale.src.tmp"; then
			found="$name"
			break
		fi
	done

	if [ -z "$found" ]; then
		echo "note: $locale has no bot.json or bot.jsonc — skipping." >&2
		rm -f "messages/$locale.src.tmp"
		continue
	fi

	# Written to a temporary file first: a half-downloaded or malformed source
	# must not replace a good translation already in the tree.
	if node scripts/jsonc-to-json.mjs "messages/$locale.src.tmp" "messages/$locale.json.tmp"; then
		mv "messages/$locale.json.tmp" "messages/$locale.json"
		pulled+=("$locale")
		echo "Pulled $locale ($found)"
	else
		echo "warning: $locale is not valid and was left unchanged." >&2
		rm -f "messages/$locale.json.tmp"
	fi

	rm -f "messages/$locale.src.tmp"
done

# A language present upstream but not imported by the catalogue is pulled and
# then ignored, which looks like the sync silently doing nothing. Say so rather
# than let somebody hunt for it.
for locale in "${pulled[@]}"; do
	if ! grep -q "messages/$locale.json" src/i18n/catalog.ts; then
		echo "note: $locale is not imported in src/i18n/catalog.ts, so the bot will not" >&2
		echo "      use it. Add it there to ship it." >&2
	fi
done

echo
echo "Pulled ${#pulled[@]} locale(s) from $REPO@$REF."
echo "Import any new one in src/i18n/catalog.ts, then commit messages/."
