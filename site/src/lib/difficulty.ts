const labels: Record<string, string> = {
  toddler: 'Very few shapes',
  easy: 'Easy lines',
  medium: 'More to color',
  detailed: 'Detailed lines',
};

export function difficultyLabel(difficulty: string) {
  return labels[difficulty] ?? 'Easy lines';
}
