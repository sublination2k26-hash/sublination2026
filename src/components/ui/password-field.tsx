"use client";

import { useId, useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import "./password-field.css";

type PasswordFieldProps = Omit<ComponentProps<"input">, "type"> & { label: string };

export function PasswordField({ label, id, ...props }: PasswordFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  return <div className="password-field">
    <label htmlFor={inputId}>{label}</label>
    <div className="password-field-control">
      <input {...props} id={inputId} type={visible ? "text" : "password"}/>
      <button type="button" disabled={props.disabled} aria-label={`${visible ? "Hide" : "Show"} ${label.replace(/\s*\*$/, "").toLowerCase()}`} aria-controls={inputId} aria-pressed={visible} onClick={() => setVisible(value => !value)}>
        {visible ? <EyeOff size={18} aria-hidden="true"/> : <Eye size={18} aria-hidden="true"/>}
      </button>
    </div>
  </div>;
}
