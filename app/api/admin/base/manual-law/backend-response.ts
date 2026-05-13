export async function readBackendJson(res: Response) {
  const text = await res.text()
  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch {
    const preview = text.replace(/\s+/g, " ").slice(0, 180)
    return {
      error: `Backend returned non-JSON response (${res.status}): ${preview}`,
    }
  }
}
