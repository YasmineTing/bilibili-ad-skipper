function parseTime(value: string, attributeName: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const number = Number(trimmed);
    return /ms/i.test(attributeName) ? number : number * 1000;
  }
  const parts = trimmed.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 2) return (parts[0]! * 60 + parts[1]!) * 1000;
  if (parts.length === 3) return (parts[0]! * 3600 + parts[1]! * 60 + parts[2]!) * 1000;
  return null;
}

function allOpenShadowElements(root: Document | ShadowRoot, output: Element[] = []): Element[] {
  for (const element of root.querySelectorAll("*")) {
    output.push(element);
    if (element.shadowRoot) allOpenShadowElements(element.shadowRoot, output);
  }
  return output;
}

export class VCaptionsAdapter {
  isDetected(): boolean {
    return Boolean(
      document.getElementById("vcaptions-subtitle-bar-root") ||
      document.getElementById("vcaptions-subtitle-iframe") ||
      document.querySelector("video[data-vcaptions-target-video]")
    );
  }

  isPresent(): boolean {
    return Boolean(document.getElementById("vcaptions-subtitle-bar-root"));
  }

  getCurrentSubtitle(): string | null {
    const root = document.getElementById("vcaptions-subtitle-bar-root");
    const bar = root?.shadowRoot?.querySelector<HTMLElement>("#vcaptions-subtitle");
    const text = bar?.innerText.trim();
    return text || null;
  }

  tryClickTime(targetMs: number): boolean {
    const root = document.getElementById("vcaptions-subtitle-bar-root");
    if (!root?.shadowRoot) return false;
    const candidates = allOpenShadowElements(root.shadowRoot).filter((element) => {
      if (element.closest("#vcaptions-subtitle") && !element.closest("[data-caption-list]")) return false;
      if (element.matches("button[data-vc-config-anchor], [data-vc-bar-interactive]")) return false;
      for (const attribute of Array.from(element.attributes)) {
        if (!/time|start|from|second|offset/i.test(attribute.name)) continue;
        const timeMs = parseTime(attribute.value, attribute.name);
        if (timeMs != null) return Math.abs(timeMs - targetMs) <= 2000;
      }
      return false;
    });
    const candidate = candidates[0];
    if (!candidate) return false;
    const clickable = candidate.closest<HTMLElement>("button, [role='button'], a, li, [data-caption-item]") ??
      (candidate instanceof HTMLElement ? candidate : null);
    if (!clickable) return false;
    clickable.click();
    return true;
  }
}
