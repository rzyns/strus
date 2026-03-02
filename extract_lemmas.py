#!/usr/bin/env python3
"""
Extract Polish lemmas from an Anki export file.
Output: TSV with columns: lemma, translation, pos, aspect, frequency, source_deck, notes

The Anki export format:
  - Lines starting with '#' are metadata/comments
  - Data rows are tab-separated with 14 columns:
    1:guid  2:notetype  3:deck  4:front  5:back
    6-13: extra fields (vary by notetype)  14:tags

For "Polish (from notes)" notetype, extra fields are:
    6:PartOfSpeech  7:Aspect  8:VerbPair  9:Gender
    10:CaseGovernance  11:Frequency  12:MinimalPair  13:Example
"""

import csv
import re
import html
import sys


def strip_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    # Remove [sound:...] annotations
    text = re.sub(r"\[sound:[^\]]*\]", "", text)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def clean_translation(text: str) -> str:
    """Keep only the primary meaning, strip examples/long extras."""
    # Remove 'Example: ...' suffixes
    text = re.sub(r"\s+Example:.*$", "", text, flags=re.IGNORECASE)
    # Remove bracketed annotations like '(I drink milk every day)'
    text = re.sub(r"\s*\([^)]{20,}\)", "", text)
    # Remove 'From X = ...' / 'Also: ...' etc.
    text = re.sub(r"\s+(Also|From|Literal|Response|Answer|Note|Polite)[^.]*$", "", text, flags=re.IGNORECASE)
    text = text.strip().rstrip(".,;")
    return text


def clean_lemma(text: str) -> str:
    """Strip grammar annotations like '+ biernik', '+ infinitive', '! (imperative)', etc."""
    # Remove ' + X' suffixes (grammar notes)
    text = re.sub(r"\s*\+\s*\w+.*$", "", text).strip()
    # Remove trailing '!' (imperative forms) — we keep the word but normalise
    text = text.rstrip("!")
    return text.strip()


def is_sentence(text: str) -> bool:
    """Heuristic: is this a full sentence rather than a lemma/phrase?"""
    words = text.split()
    # Very long → clearly a sentence
    if len(words) > 5:
        return True
    # Contains a comma → usually sentence or list of synonyms (handled separately)
    if "," in text:
        return True
    # Contains digits → dates/numerics
    if re.search(r"\d", text):
        return True
    # Uppercase start + more than 2 words → likely a sentence/command
    if text[0].isupper() and len(words) > 2:
        return True
    return False


def is_roman_numeral_only(text: str) -> bool:
    return bool(re.fullmatch(r"[IVXLCDMivxlcdm||\-–]+", text.strip()))


def split_alternatives(text: str) -> list[str]:
    """Split on ' → ', ' / ', handling 'A → B' and 'A / B / C' patterns."""
    if " → " in text:
        return [p.strip() for p in text.split(" → ")]
    if " / " in text:
        return [p.strip() for p in text.split(" / ")]
    return [text]


SKIP_DECKS = {"Polish Dates", "Polish Months (roman numeral)"}

# Entries we know are not lemmas (multi-word phrases with grammar notes in the front)
SKIP_PATTERNS = [
    r"^\w+ \+ \w",           # "Znać + biernik", "Móc + infinitive"
    r"^Jeśli\b",             # conditional sentences
    r"^\w+iemy\s",           # conjugated verb form + more words ("zaczniemy bez Ciebie")
    r"^(Napisz|Włącz|Rozładował|Telefon|Nie działa|Nie mam|Skończy|Czy mogę)\b",
    r"^zrobić screena$",
    r"^nauczyłam się od",
    r"^Jest zajęte$",
]
SKIP_PATTERNS_COMPILED = [re.compile(p) for p in SKIP_PATTERNS]


seen_lemmas: set[str] = set()
results: list[dict] = []


def add_lemma(lemma: str, translation: str, pos: str = "", aspect: str = "",
              frequency: str = "", deck: str = "", notes: str = "") -> None:
    lemma = lemma.strip()
    translation = clean_translation(translation.strip())
    if not lemma or not translation:
        return
    key = lemma.lower()
    if key in seen_lemmas:
        return
    seen_lemmas.add(key)
    results.append({
        "lemma": lemma,
        "translation": translation,
        "pos": pos,
        "aspect": aspect,
        "frequency": frequency,
        "source_deck": deck,
        "notes": notes,
    })


with open("/home/openclaw/dev/strus/All Decks.txt", encoding="utf-8") as f:
    raw = f.read()

lines = raw.splitlines()
data_lines = [line for line in lines if not line.startswith("#")]

reader = csv.reader(data_lines, delimiter="\t", quotechar='"')

from_notes_header_seen = False

for row in reader:
    if len(row) < 5:
        continue

    notetype = row[1].strip()
    deck = row[2].strip()

    if deck in SKIP_DECKS:
        continue

    front_raw = row[3]
    back_raw = row[4]

    # ── "Polish (from notes)" — richly structured ────────────────────────────
    if notetype == "Polish (from notes)":
        if not from_notes_header_seen:
            from_notes_header_seen = True
            if front_raw.strip() == "Polish":
                continue  # skip header row

        lemma = strip_html(front_raw).strip()
        translation = strip_html(back_raw).strip()

        pos = strip_html(row[5]).strip() if len(row) > 5 else ""
        aspect = strip_html(row[6]).strip() if len(row) > 6 else ""
        frequency = strip_html(row[10]).strip() if len(row) > 10 else ""

        if lemma and not is_sentence(lemma) and not is_roman_numeral_only(lemma):
            for alt in split_alternatives(lemma):
                alt = alt.strip()
                if alt:
                    add_lemma(alt, translation, pos=pos, aspect=aspect,
                              frequency=frequency, deck=deck)
        continue

    # ── All other note types ──────────────────────────────────────────────────
    front = strip_html(front_raw).strip()
    back = strip_html(back_raw).strip()

    if not front:
        continue

    # Apply explicit skip patterns
    if any(p.search(front) for p in SKIP_PATTERNS_COMPILED):
        continue

    if is_roman_numeral_only(front):
        continue

    # Handle 'X → Y' and 'X / Y / Z' patterns (e.g. "zabraniać → zabronić")
    parts = split_alternatives(front)

    # After splitting, check each part individually
    for part in parts:
        part = clean_lemma(part)
        if not part:
            continue
        if is_sentence(part) or is_roman_numeral_only(part):
            continue

        # Translation: trim to primary meaning only
        # Remove 'Example:' lines from back, take first meaningful part
        translation = re.split(r"\n|Example:|Przykład:", back)[0].strip()
        if len(translation) > 100:
            translation = translation[:100].rsplit(" ", 1)[0] + "…"

        add_lemma(part, translation, deck=deck)


# ── Write output TSV ──────────────────────────────────────────────────────────
output_path = "/home/openclaw/dev/strus/polish_lemmas.tsv"
with open(output_path, "w", encoding="utf-8") as out:
    out.write("lemma\ttranslation\tpos\taspect\tfrequency\tsource_deck\tnotes\n")
    for r in results:
        out.write("\t".join([
            r["lemma"],
            r["translation"],
            r["pos"],
            r["aspect"],
            r["frequency"],
            r["source_deck"],
            r["notes"],
        ]) + "\n")

print(f"Extracted {len(results)} unique lemmas → {output_path}")
