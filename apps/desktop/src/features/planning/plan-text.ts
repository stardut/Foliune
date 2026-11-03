// Closing punctuation travels with its preceding grapheme when the next line can hold both.
const lineStartPunctuation = new Set(Array.from('。，、；：！？）】》〉〕」』”’»％%,.;:!?)]}'));

/** Measure every output line; preserve grapheme clusters, long words and explicit blank lines. */
export function wrapPlanText(context: Pick<CanvasRenderingContext2D, 'measureText'>, text: string, width: number): string[] {
  const lines: string[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    const characters = Array.from(segmenter.segment(paragraph.replace(/\t/g, '    ')), ({ segment }) => segment);
    let start = 0;
    while (start < characters.length) {
      let end = start;
      let lastSpace = -1;
      let candidate = '';
      while (end < characters.length && context.measureText(candidate + characters[end]).width <= width) {
        if (characters[end] === ' ' && end > start) lastSpace = end;
        candidate += characters[end++];
      }
      if (end === start) throw new Error('策划包含超出长图行宽的字符，无法完整排版。');
      const breakAtSpace = end < characters.length && lastSpace > start;
      let cut = breakAtSpace ? lastSpace : end;
      let nextStart = cut + (breakAtSpace ? 1 : 0);
      if (lineStartPunctuation.has(characters[nextStart])) {
        let closingEnd = nextStart;
        while (lineStartPunctuation.has(characters[closingEnd])) closingEnd++;
        let carry = cut - 1;
        while (carry > start && (lineStartPunctuation.has(characters[carry]) || characters[carry] === ' ')) carry--;
        // Keep this line nonempty and measure the entire closing run. Tiny widths may
        // make the rule impossible; retain the original fitting break in that case.
        if (carry > start && context.measureText(characters.slice(carry, closingEnd).join('')).width <= width) {
          cut = carry;
          nextStart = carry;
        }
      }
      lines.push(characters.slice(start, cut).join(''));
      start = nextStart;
    }
  }
  return lines;
}

