// Maps raw provider/network errors to short German messages; the raw text stays available as details.
export interface FriendlyError {
  title: string;
  details: string;
}

export function friendlyError(raw: unknown): FriendlyError {
  const details = String(raw instanceof Error ? raw.message : raw);
  const s = details.toLowerCase();
  const status = Number(details.match(/^(\d{3})/)?.[1] ?? 0);
  let title = "Die KI hat gerade nicht geantwortet.";
  if (status === 401 || s.includes("invalid api key") || s.includes("invalid x-api-key") || s.includes("incorrect api key"))
    title = "Der API-Schlüssel ist ungültig.";
  else if (s.includes("kein api-schlüssel")) title = "Es ist noch kein API-Schlüssel hinterlegt.";
  else if (status === 429 || s.includes("rate limit")) title = "Zu viele Anfragen – bitte kurz warten.";
  else if (s.includes("insufficient_quota") || s.includes("credit balance") || s.includes("billing"))
    title = "Das Guthaben beim Anbieter reicht nicht aus.";
  else if (status === 404 || s.includes("model_not_found") || s.includes("does not exist") || s.includes("not_found_error"))
    title = "Dieses Modell ist mit deinem Schlüssel nicht verfügbar.";
  else if (status === 400) title = "Die Anfrage wurde vom Anbieter abgelehnt.";
  else if (status >= 500 || status === 529 || s.includes("overloaded")) title = "Der Anbieter ist gerade überlastet.";
  else if (s.includes("error sending request") || s.includes("dns") || s.includes("network") || s.includes("timed out"))
    title = "Keine Verbindung zum Anbieter.";
  else if (s.includes("abgelehnt")) title = "Das Modell hat diese Anfrage abgelehnt.";
  return { title, details };
}
