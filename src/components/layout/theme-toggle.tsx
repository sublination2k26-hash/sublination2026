"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const storageKey = "sublimation-theme";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey) === "dark";
    setDark(saved);
    document.documentElement.dataset.theme = saved ? "dark" : "light";
  }, []);

  function toggleTheme() {
    const nextDark = !dark;
    setDark(nextDark);
    document.documentElement.dataset.theme = nextDark ? "dark" : "light";
    window.localStorage.setItem(storageKey, nextDark ? "dark" : "light");
  }

  return <button
    className="icon-button theme-toggle"
    type="button"
    onClick={toggleTheme}
    aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    title={dark ? "Switch to light mode" : "Switch to dark mode"}
  >{dark ? <Sun size={17}/> : <Moon size={17}/>}</button>;
}
