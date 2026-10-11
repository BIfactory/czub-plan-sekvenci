import { useEffect, useState } from "react";

// yyyy-MM-dd z lokalnich casti data (ne toISOString(), ktera prevadi na UTC a v nocnich
// hodinach by mohla vratit jiny den nez je aktualne lokalne).
function toDateInputValue(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function computeYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateInputValue(d);
}

// "Vcera" (PRD 6.2 / Vyhodnocení.pa.yaml: Today()-1), ktere se sam posouva s pulnoci.
// Drive se pocitalo jen jednou pri nacteni stranky - zalozka nechana otevrena pres noc
// pak dal nacitala puvodni den a uzivatel si toho nevsiml. Prepocet bezi v intervalu
// a hlavne pri navratu na zalozku (visibilitychange), protoze timery v neaktivni zalozce
// prohlizec zpomaluje. Stejny string nevyvola re-render, takze je to levne.
export function useYesterday(): string {
  const [value, setValue] = useState(computeYesterday);

  useEffect(() => {
    const update = () => setValue(computeYesterday());
    const id = setInterval(update, 30 * 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return value;
}
