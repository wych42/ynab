/** Reserve space for full 11px money ticks, including currency and sign. */
export function chartMoneyLayout(values: readonly (number | null)[], format: (value: number) => string) {
  const amounts = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const largest = amounts.reduce((max, value) => Math.max(max, Math.abs(value)), 1);
  // Recharts rounds its automatic domain beyond the data. Include the next
  // magnitude, without passing an unsafe integer to the money formatter.
  const bound = Math.min(Number.MAX_SAFE_INTEGER, 10 ** Math.ceil(Math.log10(largest)));
  const labels = [0, bound, -bound, ...amounts].map(format);
  // Budget each final formatted character generously for the 11px axis font.
  // Wide currency glyphs receive a full glyph allowance; add tick/padding room.
  const labelWidth = (label: string) => Array.from(label).reduce((width, char) =>
    width + (char.codePointAt(0)! > 255 ? 14 : 8), 0);
  const axisWidth = Math.max(70, ...labels.map(label => labelWidth(label) + 16));
  return { axisWidth, minChartWidth: axisWidth + 208 };
}
