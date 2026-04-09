/**
 * Visual anonymization for demo / review videos.
 * Maps real profile names to stable pseudonyms.
 * No data leaves the server — purely cosmetic.
 */

const PSEUDONYMS = [
  "Researcher A",
  "Researcher B",
  "Researcher C",
  "Researcher D",
  "Researcher E",
  "Researcher F",
  "Researcher G",
  "Researcher H",
  "Researcher I",
  "Researcher J",
];

const nameMap = new Map<string, string>();
let nextIndex = 0;

export function anonymize(realName: string): string {
  if (!nameMap.has(realName)) {
    nameMap.set(realName, PSEUDONYMS[nextIndex % PSEUDONYMS.length]);
    nextIndex++;
  }
  return nameMap.get(realName)!;
}
