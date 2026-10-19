const INTERNAL_AUTH_DOMAIN = "staff.sublime.invalid";

export function employeeLoginToAuthEmail(loginId: string): string {
  const normalized = loginId.trim().toLowerCase();
  return normalized.includes("@") ? normalized : `${normalized}@${INTERNAL_AUTH_DOMAIN}`;
}

export function authEmailToEmployeeLogin(email: string): string {
  const normalized = email.trim().toLowerCase();
  const suffix = `@${INTERNAL_AUTH_DOMAIN}`;
  return normalized.endsWith(suffix) ? normalized.slice(0, -suffix.length) : email;
}
