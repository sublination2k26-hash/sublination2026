import { money } from "./attendance";

// Render text through the browser font system so employee names retain Unicode characters.
export function downloadPayslip(
  slip: { payslip_no: number; employee_name: string; issue_date: string; period_start: string; period_end: string; net_pay: number } & Record<string, unknown>,
  labels: Record<string, string>, role: string,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 1240; canvas.height = 1754;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PDF rendering is unavailable in this browser.");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#17202b"; ctx.font = "bold 36px Arial";
  ctx.fillText("SUBLI-NATION · PAYSLIP", 90, 120);
  ctx.font = "24px Arial";
  const rows = [
    `Payslip: PS-${String(slip.payslip_no).padStart(3, "0")}`,
    `Issued: ${slip.issue_date}`,
    `Employee: ${slip.employee_name}`,
    `Position / role: ${role}`,
    `Pay period: ${slip.period_start} to ${slip.period_end}`,
    "", "EARNINGS / DEDUCTIONS (PHP)",
  ];
  let y = 195;
  for (const row of rows) { ctx.fillText(row, 90, y, 1060); y += 48; }
  for (const [key, label] of Object.entries(labels)) {
    ctx.fillText(label, 90, y); ctx.textAlign = "right";
    ctx.fillText(money(Number(slip[key])), 1150, y); ctx.textAlign = "left"; y += 52;
  }
  y += 30; ctx.fillStyle = "#099d43"; ctx.font = "bold 30px Arial";
  ctx.fillText(`NET PAY: ${money(slip.net_pay)}`, 90, y);
  ctx.fillStyle = "#667085"; ctx.font = "20px Arial";
  ctx.fillText("This payslip records salary amounts; it is not proof of payment.", 90, y + 85);
  const jpeg = atob(canvas.toDataURL("image/jpeg", 0.95).split(",")[1]);
  const stream = "q 595 0 0 842 0 0 cm /Im0 Do Q";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
    `<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n${jpeg}\nendstream`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const url = URL.createObjectURL(new Blob([Uint8Array.from(pdf, char => char.charCodeAt(0))], { type: "application/pdf" }));
  const link = document.createElement("a"); link.href = url; link.download = `PS-${String(slip.payslip_no).padStart(3, "0")}.pdf`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
