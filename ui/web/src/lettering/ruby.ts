/* Furigana markup and the units text is broken into.

   {漢字|かんじ}      ruby over a group      {漢|かん}{字|じ}  one group per character
   |漢字《かんじ》     web-novel style (｜ works too)
   漢字《かんじ》      the kanji run right before 《 is the base */

export interface Segment { text: string; ruby?: string }

const KANJI = /[㐀-䶿一-鿿豈-﫿々〆ヶ〇]/;

export function parseRuby(src: string): Segment[] {
  const out: Segment[] = [];
  let plain = "";
  const flush = () => { if (plain) out.push({ text: plain }); plain = ""; };
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === "{") {
      const close = src.indexOf("}", i), bar = src.indexOf("|", i);
      if (close > 0 && bar > i && bar < close && !src.slice(i + 1, close).includes("\n")) {
        flush(); out.push({ text: src.slice(i + 1, bar), ruby: src.slice(bar + 1, close) }); i = close + 1; continue;
      }
    }
    if (c === "|" || c === "｜") {
      const open = src.indexOf("《", i), close = src.indexOf("》", open);
      if (open > i + 1 && close > open && !src.slice(i, close).includes("\n")) {
        flush(); out.push({ text: src.slice(i + 1, open), ruby: src.slice(open + 1, close) }); i = close + 1; continue;
      }
    }
    if (c === "《") {
      const close = src.indexOf("》", i);
      let k = plain.length;
      while (k > 0 && KANJI.test(plain[k - 1])) k--;
      if (close > i && k < plain.length && !src.slice(i, close).includes("\n")) {
        const base = plain.slice(k); plain = plain.slice(0, k); flush();
        out.push({ text: base, ruby: src.slice(i + 1, close) }); i = close + 1; continue;
      }
    }
    plain += c; i++;
  }
  flush();
  return out;
}

/** The text with the markup taken out, as a reader sees it. */
export const plainText = (src: string): string => parseRuby(src).map(s => s.text).join("");

export type Kind = "cjk" | "latin" | "tcy" | "space" | "nl";
export interface Tok { t: string; k: Kind }
/** What a line can break between: one token, or a ruby group that stays together. */
export interface Unit { toks: Tok[]; ruby?: string }

export const isCJK = (c: string): boolean => {
  const n = c.codePointAt(0) || 0;
  return n >= 0x2e80 || (n >= 0x2010 && n <= 0x2027) || (n >= 0x2190 && n <= 0x21ff) || (n >= 0x25a0 && n <= 0x27bf);
};

/* In vertical text short runs of digits (up to 4) or of !? stand upright side by side (tate-chu-yoko);
   longer Latin runs lie on their side. */
export function tcy(t: string): boolean {
  return /^[0-9]{1,4}$/.test(t) || /^[!?]{1,3}$/.test(t) || /^[A-Za-z0-9]{1,2}$/.test(t);
}

export function tokenize(text: string, vertical: boolean): Tok[] {
  const out: Tok[] = [];
  const re = /\n|[ \t]+|　|[0-9]+|[!?]+(?![A-Za-z0-9])|[^\s　]/gu;
  let latin = "";
  const flush = () => { if (latin) out.push({ t: latin, k: vertical && tcy(latin) ? "tcy" : "latin" }); latin = ""; };
  for (const m of text.matchAll(re)) {
    const s = m[0];
    if (s === "\n") { flush(); out.push({ t: s, k: "nl" }); }
    else if (/^[ \t]+$/.test(s)) { flush(); out.push({ t: " ", k: "space" }); }
    else if (s === "　") { flush(); out.push({ t: s, k: "cjk" }); }
    else if (isCJK(s)) { flush(); out.push({ t: s, k: "cjk" }); }
    else latin += s;
  }
  flush();
  return out;
}

export function units(src: string, vertical: boolean): Unit[] {
  const out: Unit[] = [];
  for (const seg of parseRuby(src)) {
    const toks = tokenize(seg.text, vertical);
    if (seg.ruby && toks.length && !toks.some(t => t.k === "nl")) out.push({ toks, ruby: seg.ruby });
    else for (const t of toks) out.push({ toks: [t] });
  }
  return out;
}
