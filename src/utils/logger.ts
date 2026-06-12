export function log(message: string, level: 'INFO' | 'ERROR' | 'DEBUG' = 'INFO') {
  const timestamp = new Date().toLocaleString('id-ID');
  const logMessage = `[${timestamp}] [${level}] ${message}`;

  console.log(logMessage);
}

export function logError(message: string, error?: unknown) {
  let fullMessage = message;
  if (error instanceof Error) {
    fullMessage += ` | Error: ${error.message}`;
    if (error.stack) {
      fullMessage += `\nStack: ${error.stack}`;
    }
  } else if (error) {
    fullMessage += ` | Error: ${JSON.stringify(error)}`;
  }
  log(fullMessage, 'ERROR');
}

export function logDebug(message: string) {
  log(message, 'DEBUG');
}
