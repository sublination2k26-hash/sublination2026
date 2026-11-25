"use client";

import { useEffect, useRef, type HTMLAttributes, type RefObject } from "react";
import "./table-scroll.css";

export function TableScroll({ children, className = "", regionRef, ...props }: HTMLAttributes<HTMLDivElement> & {
  regionRef?: RefObject<HTMLDivElement | null>;
}) {
  const localRef = useRef<HTMLDivElement>(null);
  const ref = regionRef ?? localRef;
  useEffect(() => {
    const region = ref.current;
    if (!region) return;
    const labelRows = () => {
      const table = region.querySelector("table");
      if (!table) return;
      table.setAttribute("role", "table");
      const headers: string[] = [];
      for (const cell of Array.from(table.tHead?.rows[0]?.cells ?? [])) {
        for (let column = 0; column < cell.colSpan; column++) headers.push(cell.textContent?.trim() ?? "");
      }
      for (const row of Array.from(table.rows)) {
        row.parentElement?.setAttribute("role", "rowgroup");
        row.setAttribute("role", "row");
        const inHeader = row.parentElement === table.tHead;
        let column = 0;
        for (const cell of Array.from(row.cells)) {
          cell.setAttribute("role", cell.tagName === "TD" ? "cell" : inHeader ? "columnheader" : "rowheader");
          if (!inHeader) {
            const label = cell.dataset.label ?? (cell.colSpan === 1 ? headers[column] : "");
            if (label) cell.dataset.mobileLabel = label;
            else delete cell.dataset.mobileLabel;
          }
          column += cell.colSpan;
        }
      }
    };
    labelRows();
    const observer = new MutationObserver(labelRows);
    observer.observe(region, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [ref]);

  return <div {...props} ref={ref} className={`table-scroll ${className}`} role={props.role ?? "region"}
    aria-label={props["aria-label"] ?? "Table records"} tabIndex={props.tabIndex ?? 0}>{children}</div>;
}
