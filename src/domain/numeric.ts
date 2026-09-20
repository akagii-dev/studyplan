export function parseNumberInput(
  text: string,
  min?: number | string,
  max?: number | string,
  step: number | string = 1,
): number {
  const raw = text.trim();
  if (!raw) throw new Error('数値を入力してください。空欄のまま確定できません。');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) || !Number.isFinite(Number(raw)))
    throw new Error('数値を入力してください。');
  const value = Number(raw);
  if (step !== 'any') {
    const size = Number(step);
    const offset = min === undefined ? 0 : Number(min);
    if (size > 0 && Math.abs((value - offset) / size - Math.round((value - offset) / size)) > 1e-7)
      throw new Error(size === 1 ? '整数で入力してください。' : `${size}単位で入力してください。`);
  }
  if (min !== undefined && value < Number(min)) throw new Error(`${min}以上で入力してください。`);
  if (max !== undefined && value > Number(max)) throw new Error(`${max}以下で入力してください。`);
  return value;
}
