#!/usr/bin/env python3
"""
Bulk import Polish lemmas from polish_lemmas.tsv into the strus API.

Strategy:
  - Single-word lemmas → POST /api/import/text (Morfeusz2 normalises imperative forms)
  - Multi-word lemmas  → POST /api/lemmas individually with source=manual
"""

import csv
import sys
import json
import urllib.request
import urllib.error

API_URL = "http://localhost:3457"
TSV_PATH = "polish_lemmas.tsv"


def api_post(path: str, body: dict) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{API_URL}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        msg = e.read().decode()
        raise RuntimeError(f"POST {path} → {e.code}: {msg}") from e


def infer_pos(lemma: str) -> str:
    """Best-effort POS for multi-word manual lemmas."""
    low = lemma.lower()
    # Reflexive verbs end with "się" or contain "się" in the phrase
    if low.endswith(" się") or " się " in low:
        return "verb"
    # Verb infinitives (common Polish infinitive-looking starters)
    verb_starters = ("być ", "mieć ", "bać ", "dać ", "wyczerpyw", "klepać", "bujać",
                     "owijać", "wierzyć", "pogoda")
    if any(low.startswith(v) for v in verb_starters):
        return "verb"
    # Prepositional phrases / idioms
    if low.startswith(("bez ", "ze ", "o ", "aż ", "póki ")):
        return "phrase"
    return "phrase"


def main():
    single_word: list[str] = []
    multi_word: list[dict] = []

    with open(TSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            lemma = row["lemma"].strip()
            if not lemma:
                continue
            if " " in lemma:
                pos = row.get("pos", "").strip() or infer_pos(lemma)
                multi_word.append({"lemma": lemma, "pos": pos})
            else:
                single_word.append(lemma)

    print(f"Single-word lemmas: {len(single_word)}")
    print(f"Multi-word lemmas:  {len(multi_word)}")
    print()

    # --- Single-word via import/text ---
    print("=== Importing single-word lemmas via import/text ===")
    text = " ".join(single_word)
    result = api_post("/api/import/text", {"text": text})
    created = result.get("created", [])
    # skipped is a list of {lemma, reason}
    skipped = result.get("skipped", [])
    skipped_exist = [s for s in skipped if s.get("reason") == "already_exists"]
    skipped_ambig = [s for s in skipped if s.get("reason") == "ambiguous"]

    print(f"  Created:  {len(created)}")
    print(f"  Skipped (already exist): {len(skipped_exist)}")
    print(f"  Skipped (ambiguous):     {len(skipped_ambig)}")
    if skipped_ambig:
        print("  Ambiguous (not imported):")
        for s in skipped_ambig:
            print(f"    ~ {s['lemma']}")
    for c in created:
        print(f"    + {c['lemma']} ({c.get('pos','?')}) [{c.get('source','?')}]")

    # --- Multi-word via direct lemma create ---
    print()
    print("=== Importing multi-word lemmas as manual ===")
    created_manual = []
    skipped_manual = []
    errors_manual = []

    for entry in multi_word:
        try:
            resp = api_post("/api/lemmas", {
                "lemma": entry["lemma"],
                "pos": entry["pos"],
                "source": "manual",
            })
            created_manual.append(entry["lemma"])
            print(f"  + {entry['lemma']} ({entry['pos']}) [manual]")
        except RuntimeError as e:
            err_str = str(e)
            if "already exists" in err_str.lower() or "UNIQUE" in err_str:
                skipped_manual.append(entry["lemma"])
                print(f"  ~ {entry['lemma']} (already exists)")
            else:
                errors_manual.append((entry["lemma"], err_str))
                print(f"  ! {entry['lemma']}: {err_str}", file=sys.stderr)

    print()
    print("=== Summary ===")
    print(f"Single-word: {len(created)} created, {len(skipped_exist)} already existed, {len(skipped_ambig)} ambiguous")
    print(f"Multi-word:  {len(created_manual)} created, {len(skipped_manual)} already existed, {len(errors_manual)} errors")
    print(f"Total created: {len(created) + len(created_manual)}")

    if errors_manual:
        print("\nErrors:")
        for lemma, err in errors_manual:
            print(f"  {lemma}: {err}")


if __name__ == "__main__":
    main()
