export function Connect() {
  return (
    <div className="connect">
      <h2>Not connected</h2>
      <p>The host account needs to authorize Spotify once.</p>
      <a className="btn primary" href="/api/auth/login">
        Connect Spotify
      </a>
    </div>
  );
}
