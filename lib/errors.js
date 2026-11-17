export class PluginError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'PluginError'
    this.code = code
    this.details = details
  }
}

export function errorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

export function errorCode(error, fallback = 'UNKNOWN') {
  if (error && typeof error === 'object' && typeof error.code === 'string') return error.code
  return fallback
}

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    const reason = signal.reason
    if (reason instanceof Error) throw reason
    throw new PluginError('CANCELLED', 'Operation cancelled')
  }
}

export function toErrorData(error, fallback = 'UNKNOWN') {
  return {
    errorCode: errorCode(error, fallback),
    message: errorMessage(error),
    ...(error && typeof error === 'object' && error.details !== undefined ? { details: error.details } : {}),
  }
}
