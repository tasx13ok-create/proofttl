export class AuditError extends Error {
  constructor(code, status = 400) { super(code); this.name = 'AuditError'; this.code = code; this.status = status; }
}
export function requireCondition(condition, code, status = 400) {
  if (!condition) throw new AuditError(code, status);
}
export function checkSignal(signal) {
  if (signal?.aborted) throw new AuditError('operation_cancelled', 408);
}
