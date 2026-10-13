export function formatVnd(minorUnits: number, locale = "vi-VN"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(minorUnits);
}

export function formatDate(epochSeconds: number, locale = "en"): string {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "medium",
  }).format(epochSeconds * 1000);
}
