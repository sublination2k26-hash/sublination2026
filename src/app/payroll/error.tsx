"use client";

export default function PayrollError({reset}:{reset:()=>void}) {
  return <main className="content"><h1>Payroll could not load</h1><p role="alert">The server could not open payroll. Try again, or sign in again if your session expired.</p><button className="primary-button" onClick={reset}>Try again</button><p><a href="/login">Sign in again</a> · <a href="/dashboard">Back to dashboard</a></p></main>;
}
