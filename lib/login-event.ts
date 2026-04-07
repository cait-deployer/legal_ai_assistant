/**
 * Fires the login-event API route (fire-and-forget).
 * Gets the real public IP from the browser (works on localhost too),
 * then sends fingerprint + clientIp to /api/auth/login-event.
 */
export async function fireLoginEvent(): Promise<void> {
  try {
    let clientIp = ""
    try {
      const r = await fetch("https://api.ipify.org?format=json", {
        signal: AbortSignal.timeout(3000),
      })
      const d = await r.json()
      clientIp = d.ip ?? ""
    } catch {
      // ipify unavailable — server will fall back to x-forwarded-for
    }

    await fetch("/api/auth/login-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint: getFingerprint(), clientIp }),
    })
  } catch {
    // non-critical — never block the main flow
  }
}

function getFingerprint(): string {
  try {
    const parts = [
      navigator.userAgent,
      navigator.language,
      screen.width + "x" + screen.height,
      screen.colorDepth,
      navigator.hardwareConcurrency,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.platform ?? "",
    ]
    let hash = 5381
    const str = parts.join("|")
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 33) ^ str.charCodeAt(i)
    }
    return (hash >>> 0).toString(16)
  } catch {
    return "unknown"
  }
}
