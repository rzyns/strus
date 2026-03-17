/**
 * Convert an NKJP morphosyntactic tag string into a human-readable label.
 */

const POS_PREFIX: Record<string, string> = {
  fin:    'present',
  praet:  'past',
  inf:    'infinitive',
  impt:   'imperative',
  ger:    'verbal noun',
  pact:   'active participle',
  ppas:   'passive participle',
  pcon:   'contemporary adverbial participle (converb)',
  pant:   'anterior adverbial participle (converb)',
  imps:   'impersonal form',
  bedzie: 'future',
  winien: 'ought-to form',
}

const FEAT: Record<string, string> = {
  sg: 'singular', pl: 'plural',
  nom: 'nominative', gen: 'genitive', dat: 'dative',
  acc: 'accusative', inst: 'instrumental', loc: 'locative', voc: 'vocative',
  m1: 'masc. pers.', m2: 'masc. anim.', m3: 'masc. inanim.', f: 'fem.', n: 'neut.',
  pri: '1st person', sec: '2nd person', ter: '3rd person',
  imperf: 'imperfective', perf: 'perfective',
  pos: '', comp: 'comparative', sup: 'superlative',
  aff: '', neg: 'negated',
  refl: 'reflexive', nonrefl: '',
  akc: '', nakc: '', congr: '', rec: '', wok: '', nwok: '',
}

function translateFeat(feat: string): string | null {
  const atoms = feat.split('.')
  const labels: string[] = []
  for (const atom of atoms) {
    if (!(atom in FEAT)) return null
    if (FEAT[atom] !== '') labels.push(FEAT[atom]!)
  }
  return labels.join('/')
}

export function formatTag(tag: string): string {
  const parts = tag.split(':')
  const pos = parts[0] ?? tag
  const feats = parts.slice(1)
  const segments: string[] = []

  const posLabel = POS_PREFIX[pos]
  if (posLabel !== undefined) segments.push(posLabel)

  for (const feat of feats) {
    const label = translateFeat(feat)
    if (label === null) segments.push(feat)
    else if (label !== '') segments.push(label)
  }

  return segments.join(' · ') || tag
}
