const originalConsoleLogForView = console.log ? console.log.bind(console) : () => {};

/**
 * Logs a view-update action for debugging, always using the original console even if the shared logger is disabled.
 * @param {string} reason
 * @param {Object} details
 */
function logViewMovement(reason, details = {}) {
    const payload = {
        reason,
        timestamp: new Date().toISOString(),
        ...details
    };
    originalConsoleLogForView('[view-scroll]', payload);
    if (window.kanbanDebug && typeof window.kanbanDebug.log === 'function') {
        window.kanbanDebug.log('[view-scroll]', payload);
    }
}

window.logViewMovement = logViewMovement;

export { logViewMovement };
