"use client";

export default function MessagesError({ reset }: { reset: () => void }) {
  return <main className="login-screen"><div className="login-card"><h1>Messages could not open</h1><p>Check your connection, then try again.</p><button className="primary-button" onClick={reset}>Try again</button></div></main>;
}
