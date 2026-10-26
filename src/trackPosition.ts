/** 接收上游整数或整数字符串；缺失和无效位置不对外返回。 */
export function positionInteger(value: unknown, minimum = 1): number | undefined {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value.trim()))) {
    return undefined;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : undefined;
}
