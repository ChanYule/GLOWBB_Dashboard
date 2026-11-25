export async function downloadRankingChart(
  title: string,
  rows: { label: string; value: number | null; displayValue?: string }[],
  unit: string,
  denominator?: number | null,
  output: "svg" | "png" = "svg",
) {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const width = 1440,
    top = 110,
    rowHeight = 88;
  const numbers = rows.flatMap((row) => (row.value == null ? [] : [row.value]));
  const minimum = Math.min(0, ...numbers),
    maximum = Math.max(1, ...numbers);
  const scale = (value: number) =>
    810 + ((value - minimum) / (maximum - minimum)) * 525;
  const format = new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 });
  const body = rows
    .map((row, index) => {
      const y = top + index * rowHeight;
      const lines = row.label.match(/.{1,90}(?:\s|$)|.{1,90}/g) || [""];
      const label = lines
        .slice(0, 3)
        .map(
          (line, i) =>
            `<tspan x="40" dy="${i ? 23 : 0}">${escape(line.trim())}</tspan>`,
        )
        .join("");
      const value = escape(
        row.displayValue ??
          (row.value == null ? "Unavailable" : format.format(row.value) + unit),
      );
      const start = scale(Math.min(0, row.value ?? 0)),
        end = scale(Math.max(0, row.value ?? 0));
      return (
        `<text x="40" y="${y}" font-size="22">${label}</text><text x="1390" y="${y}" text-anchor="end" font-size="22">${value}</text>` +
        (row.value == null
          ? ""
          : `<rect x="${start}" y="${y + 12}" width="${end - start}" height="15" rx="4" fill="#2563eb"/>`)
      );
    })
    .join("");
  const note =
    denominator && unit === "%"
      ? `Percentage denominator: ${format.format(denominator)}. Categories may overlap.`
      : "";
  const height = top + rows.length * rowHeight + 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial,sans-serif" fill="#14263d"><text x="40" y="53" font-size="34" font-weight="bold">${escape(title)}</text>${body}<text x="40" y="${height - 20}" font-size="17">${escape(note)}</text></g></svg>`;
  const url = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
  );
  let downloadUrl = url;
  if (output === "png") {
    try {
      const image = new Image();
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = width * 2;
      canvas.height = height * 2;
      const context = canvas.getContext("2d");
      if (!context) throw Error("Image export is unavailable.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const png = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!png) throw Error("Image export is unavailable.");
      downloadUrl = URL.createObjectURL(png);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = "dashboard-chart." + output;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}
