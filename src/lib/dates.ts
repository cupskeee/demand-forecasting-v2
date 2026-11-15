// Month parsing. A month is stored as one number: year * 12 + month (January = 0).

const NAMES: Record<string, number> = {
  jan: 0, january: 0, januari: 0,
  feb: 1, february: 1, februari: 1,
  mar: 2, march: 2, maret: 2,
  apr: 3, april: 3,
  may: 4, mei: 4,
  jun: 5, june: 5, juni: 5,
  jul: 6, july: 6, juli: 6,
  aug: 7, august: 7, agu: 7, agt: 7, ags: 7, agustus: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, okt: 9, oktober: 9,
  nov: 10, november: 10, nop: 10,
  dec: 11, december: 11, des: 11, desember: 11,
};

const year = (text: string) => (text.length === 2 ? 2000 + Number(text) : Number(text));
const make = (y: number, m: number) => (m >= 0 && m <= 11 && y >= 1900 && y <= 2200 ? y * 12 + m : null);

/** Returns a parser suited to the whole column (it settles day/month order once). */
export function monthParser(values: string[]): (raw: string) => number | null {
  // For 01/02/2024-style dates, work out which part is the month.
  let dayFirst = true;
  for (const v of values) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{4}$/.exec(v.trim());
    if (m && Number(m[2]) > 12) {
      dayFirst = false;
      break;
    }
  }
  return (raw: string) => {
    const s = raw.trim();
    let m: RegExpExecArray | null;
    if ((m = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?(?:[T ].*)?$/.exec(s))) return make(+m[1], +m[2] - 1);
    if ((m = /^(\d{4})(\d{2})$/.exec(s))) return make(+m[1], +m[2] - 1);
    if ((m = /^(\d{4})[- ]?M(\d{1,2})$/i.exec(s))) return make(+m[1], +m[2] - 1);
    if ((m = /^(\d{1,2})[-/.](\d{4})$/.exec(s))) return make(+m[2], +m[1] - 1);
    if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) {
      return make(+m[3], (dayFirst ? +m[2] : +m[1]) - 1);
    }
    if ((m = /^(?:\d{1,2}[ -])?([A-Za-z]{3,9})[ \-/,.']*(\d{4}|\d{2})$/.exec(s))) {
      const month = NAMES[m[1].toLowerCase()];
      return month === undefined ? null : make(year(m[2]), month);
    }
    if ((m = /^(\d{4})[ \-/]([A-Za-z]{3,9})$/.exec(s))) {
      const month = NAMES[m[2].toLowerCase()];
      return month === undefined ? null : make(+m[1], month);
    }
    return null;
  };
}
