import { loadUiPrefs } from "./uiPrefs.js";
import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";

/** Sign-in gate: uses a ?login=<token> from the emailed link, then shows the app for a signed-in user or the email form. */
export default function AuthGate({ children }) {
  const [user, setUser] = useState(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("login");
    const got = (u) => { loadUiPrefs(u.ui); setUser(u); };
    const done = () => api.get("/auth/me").then(got).catch(() => setUser(null));
    if (!token) return void done();
    url.searchParams.delete("login");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    api.post("/auth/verify", { token }).then(got).catch((e) => { setError(e.message); done(); });
  }, []);
  if (user === undefined) return null;
  if (!user) return <Login error={error} />;
  return children(user);
}

/** Sign out: ends the session, forgets the chosen league (it belongs to this account) and goes back to the sign-in form. */
export async function signOut() {
  await api.post("/auth/logout").catch(() => {});
  localStorage.removeItem("da.league");
  window.location.reload();
}

function Login({ error: initial }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initial);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api.post("/auth/login", { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ap-login">
      <form className="panel ap-login-card" onSubmit={submit} data-testid="login">
        <span className="ap-brand-icon"><Icon name="ball" /></span>
        <h1>NBA Fantasy</h1>
        {sent ? (
          <p data-testid="login-sent">Check <strong>{email.trim()}</strong> for a sign-in link. It works once and expires in 15 minutes.</p>
        ) : (
          <>
            <p className="muted">Sign in with your email. We'll send you a link, no password needed.</p>
            <label htmlFor="login-email" className="small">Email</label>
            <input id="login-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" />
            <button type="submit" className="primary" disabled={busy || !email.trim()} data-testid="login-submit">{busy ? "Sending…" : "Email me a link"}</button>
          </>
        )}
        {error && <p className="warn-text small" role="alert">{error}</p>}
      </form>
    </div>
  );
}
