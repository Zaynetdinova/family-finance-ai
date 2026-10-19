/** Only same-site relative paths are allowed as post-login targets (prevents open redirects). */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/(?![/\\])/.test(next) ? next : '/';
}
