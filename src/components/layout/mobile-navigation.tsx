"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Activity, CircleDollarSign, FileText, Layers3, Menu, Package, Palette, Shirt, Users, X } from "lucide-react";
import { SignOutButton } from "@/components/auth/sign-out-button";

type Item = { label: string; href?: string };
const icons: Record<string, typeof Menu> = { Overview: Layers3, Orders: Shirt, Production: Activity, Payments: CircleDollarSign, Customers: Users, Products: Package, Employees: Users, Payroll: CircleDollarSign, "Time In & Out": Activity, "Job orders": FileText, Reports: Activity, "Design library": Palette };
export function MobileNavigation({ items, active, name, role, onNavigate }: { items: Item[]; active: string; name: string; role: string; onNavigate?: (label: string) => void }) {
  const drawer=useRef<HTMLDialogElement>(null);
  const id=useId();
  const [open,setOpen]=useState(false);
  const close=()=>setOpen(false);
  useEffect(()=>{
    const dialog=drawer.current;
    if(!dialog || !open) return;
    const screen=window.matchMedia("(max-width:900px)");
    if(!screen.matches){setOpen(false);return;}
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    dialog.showModal();
    const resize=()=>{if(!screen.matches)setOpen(false);};
    screen.addEventListener("change",resize);
    return ()=>{screen.removeEventListener("change",resize);dialog.close();document.body.style.overflow=previousOverflow;};
  },[open]);
  return <div className="mobile-navigation">
    <div className="mobile-navigation-bar"><span className="mobile-brand">Subli-nation</span><button className="mobile-menu-toggle" type="button" aria-label="Open navigation menu" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(true)}><Menu size={21}/><span>Menu</span></button></div>
    <dialog className="mobile-drawer" id={id} ref={drawer} aria-labelledby={`${id}-title`} onCancel={close} onClose={close} onClick={event=>{if(event.target===event.currentTarget){const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left || event.clientX>bounds.right || event.clientY<bounds.top || event.clientY>bounds.bottom)close();}}}>
      <div className="mobile-drawer-heading"><div><b id={`${id}-title`}>Subli-nation</b><span>Printing System</span></div><button className="mobile-menu-close" type="button" aria-label="Close navigation menu" onClick={close} autoFocus><X size={21}/></button></div>
      <p className="mobile-drawer-label">WORKSPACE</p>
      <nav aria-label="Mobile workspace navigation">{items.map(item=>{const Icon=icons[item.label]??Layers3;const content=<><Icon size={19}/><span>{item.label}</span></>;return item.href&&!onNavigate?<Link key={item.label} href={item.href} aria-current={active===item.label?"page":undefined} onClick={close}>{content}</Link>:<button key={item.label} type="button" aria-current={active===item.label?"page":undefined} onClick={()=>{onNavigate?.(item.label);close();}}>{content}</button>;})}</nav>
      <div className="mobile-account"><span className="mobile-account-avatar" aria-hidden="true">{name.slice(0,2).toUpperCase()}</span><div><b>{name}</b><small>{role}</small></div><SignOutButton/></div>
    </dialog>
  </div>;
}
