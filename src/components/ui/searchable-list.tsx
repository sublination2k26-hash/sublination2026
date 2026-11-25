"use client";

import { useEffect, useId, useRef, useState, type HTMLAttributes } from "react";
import { TableScroll } from "./table-scroll";
import "./searchable-list.css";

/** Filters rendered records, including formatted dates and nested status labels. */
export function SearchableList({ children, className = "", recordSelector = "table > tbody > tr", ...props }: HTMLAttributes<HTMLDivElement> & { recordSelector?: string }) {
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState({ total: 0, shown: 0 });
  const region = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const element = region.current;
    if (!element) return;
    const filter = () => {
      const rows = Array.from(element.querySelectorAll<HTMLElement>(recordSelector));
      const term = query.trim().toLocaleLowerCase();
      let shown = 0;
      for (const row of rows) {
        const fields = Array.from(row.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea"));
        const text = [row.textContent ?? "", ...fields.map(field => field instanceof HTMLSelectElement ? field.selectedOptions[0]?.textContent ?? "" : field.value)].join(" ").toLocaleLowerCase();
        const matches = !term || text.includes(term);
        row.toggleAttribute("data-list-hidden", !matches);
        if (matches) shown++;
      }
      setCounts(previous => previous.total === rows.length && previous.shown === shown ? previous : { total: rows.length, shown });
    };
    filter();
    const observer = new MutationObserver(filter);
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    element.addEventListener("input", filter);
    element.addEventListener("change", filter);
    return () => {
      observer.disconnect();
      element.removeEventListener("input", filter);
      element.removeEventListener("change", filter);
      element.querySelectorAll(recordSelector).forEach(row => row.removeAttribute("data-list-hidden"));
    };
  }, [query, children, recordSelector]);
  return <div className="searchable-list">
    <div className="searchable-list-toolbar">
      <label htmlFor={id}>Search this list<input id={id} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search names, numbers, dates..." aria-controls={`${id}-records`}/></label>
      <span role="status" aria-live="polite">{counts.shown} of {counts.total} records</span>
    </div>
    <TableScroll {...props} id={`${id}-records`} regionRef={region} className={`${className} searchable-list-scroll`}>{children}</TableScroll>
    {query.trim() && counts.shown === 0 && <p className="searchable-list-empty">No matching records. Try another search.</p>}
  </div>;
}
