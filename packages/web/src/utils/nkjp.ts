export type NKJPCase = 'nom' | 'gen' | 'dat' | 'acc' | 'inst' | 'loc' | 'voc'
export type NKJPNumber = 'sg' | 'pl'
export type NKJPGender = 'm1' | 'm2' | 'm3' | 'f' | 'n'
export type NKJPPerson = 'pri' | 'sec' | 'ter'
export type NKJPDegree = 'pos' | 'com' | 'sup'
export type NKJPAspect = 'perf' | 'imperf'

export interface ParsedNKJP {
  pos: string
  number?: NKJPNumber[]
  cases?: NKJPCase[]
  genders?: NKJPGender[]
  person?: NKJPPerson
  degree?: NKJPDegree
  aspect?: NKJPAspect
  negation?: 'aff' | 'neg'
  raw: string
}

export function parseNKJP(tag: string): ParsedNKJP {
  const parts = tag.split(':')
  const pos = parts[0]!
  const splitMulti = <T>(s?: string): T[] | undefined =>
    s ? (s.split('.') as T[]) : undefined

  const spread = <K extends string, V>(key: K, val: V | undefined): Record<K, V> | Record<string, never> =>
    val !== undefined ? ({ [key]: val } as Record<K, V>) : ({} as Record<string, never>)

  const base = { pos, raw: tag }

  switch (pos) {
    case 'subst':
      return { ...base, ...spread('number', splitMulti<NKJPNumber>(parts[1])), ...spread('cases', splitMulti<NKJPCase>(parts[2])), ...spread('genders', splitMulti<NKJPGender>(parts[3])) }
    case 'adj':
      return { ...base, ...spread('number', splitMulti<NKJPNumber>(parts[1])), ...spread('cases', splitMulti<NKJPCase>(parts[2])), ...spread('genders', splitMulti<NKJPGender>(parts[3])), degree: parts[4] as NKJPDegree }
    case 'fin':
      return { ...base, ...spread('number', splitMulti<NKJPNumber>(parts[1])), person: parts[2] as NKJPPerson, aspect: parts[3] as NKJPAspect }
    case 'praet':
      return { ...base, ...spread('number', splitMulti<NKJPNumber>(parts[1])), ...spread('genders', splitMulti<NKJPGender>(parts[2])), aspect: parts[3] as NKJPAspect }
    case 'impt':
      return { ...base, ...spread('number', splitMulti<NKJPNumber>(parts[1])), person: parts[2] as NKJPPerson, aspect: parts[3] as NKJPAspect }
    case 'ger':
    case 'pact':
    case 'ppas':
      return { ...base, ...spread('number', splitMulti<NKJPNumber>(parts[1])), ...spread('cases', splitMulti<NKJPCase>(parts[2])), ...spread('genders', splitMulti<NKJPGender>(parts[3])), aspect: parts[4] as NKJPAspect, negation: parts[5] as 'aff' | 'neg' }
    default:
      return { ...base, aspect: parts[1] as NKJPAspect }
  }
}

export const CASE_LABELS: Record<NKJPCase, string> = {
  nom: 'Nominative', gen: 'Genitive', dat: 'Dative',
  acc: 'Accusative', inst: 'Instrumental', loc: 'Locative', voc: 'Vocative',
}
export const CASE_ORDER: NKJPCase[] = ['nom', 'gen', 'dat', 'acc', 'inst', 'loc', 'voc']
export const NUMBER_LABELS: Record<NKJPNumber, string> = { sg: 'Singular', pl: 'Plural' }
export const PERSON_LABELS: Record<NKJPPerson, string> = { pri: '1st', sec: '2nd', ter: '3rd' }
export const PERSON_ORDER: NKJPPerson[] = ['pri', 'sec', 'ter']
export const DEGREE_LABELS: Record<NKJPDegree, string> = { pos: 'Positive', com: 'Comparative', sup: 'Superlative' }
export const GENDER_LABELS: Record<NKJPGender, string> = {
  m1: 'Masc. Personal', m2: 'Masc. Animate', m3: 'Masc. Inanimate', f: 'Feminine', n: 'Neuter',
}

export interface MorphFormData {
  id: string
  lemmaId: string
  orth: string
  tag: string
  parsedTag: string
  createdAt: string
}
