const labels: Record<string, string> = {
  toddler: 'a few huge shapes',
  easy: 'a simple one',
  medium: 'more to color',
  detailed: 'a fuller picture',
};

export function difficultyLabel(difficulty: string) {
  return labels[difficulty] ?? 'a simple one';
}
