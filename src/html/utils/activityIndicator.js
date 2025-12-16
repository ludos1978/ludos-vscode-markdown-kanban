/**
 * Activity Indicator Manager
 * Shows progress bars for long-running backend operations
 * CSS styles are in webview.css under "Activity Indicators" section
 */
class ActivityIndicatorManager {
    constructor() {
        this.activeOperations = new Map();
        this.createIndicatorContainer();
    }

    createIndicatorContainer() {
        // Create fixed position indicator area - styles in webview.css
        const container = document.createElement('div');
        container.id = 'activity-indicators';
        document.body.appendChild(container);
        this.container = container;
    }

    startOperation(operationId, type, description) {
        // Remove any existing operation with same ID
        this.endOperation(operationId);

        // Create progress indicator element - styles in webview.css
        const indicator = document.createElement('div');
        indicator.className = `activity-indicator activity-${type}`;

        // Create header with description
        const header = document.createElement('div');
        header.className = 'activity-header';

        // Add animated spinner
        const spinner = document.createElement('div');
        spinner.className = 'activity-spinner';

        // Add description text
        const text = document.createElement('span');
        text.className = 'activity-text';
        text.textContent = description;

        header.appendChild(spinner);
        header.appendChild(text);

        // Create progress bar container
        const progressContainer = document.createElement('div');
        progressContainer.className = 'progress-container';

        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';

        progressContainer.appendChild(progressBar);
        indicator.appendChild(header);
        indicator.appendChild(progressContainer);

        // Store operation data
        this.activeOperations.set(operationId, {
            element: indicator,
            type,
            description,
            startTime: Date.now(),
            progressContainer,
            progressBar,
            spinner,
            text
        });

        this.container.appendChild(indicator);

        // Animate in using CSS class
        setTimeout(() => {
            indicator.classList.add('visible');
        }, 10);

        // Safety cleanup after 60 seconds
        setTimeout(() => {
            if (this.activeOperations.has(operationId)) {
                this.endOperation(operationId);
            }
        }, 60000);
    }

    updateProgress(operationId, progress, message) {
        const operation = this.activeOperations.get(operationId);
        if (!operation) { return; }

        // Update description if provided
        if (message) {
            operation.text.textContent = message;
        }

        // Show and update progress bar
        if (progress >= 0 && progress <= 100) {
            operation.progressContainer.classList.add('visible');
            operation.progressBar.style.width = `${progress}%`;
        }

        // When progress reaches 100%, start fade out after brief delay
        if (progress >= 100) {
            setTimeout(() => {
                this.endOperation(operationId);
            }, 500);
        }
    }

    endOperation(operationId, immediate = false) {
        const operation = this.activeOperations.get(operationId);
        if (!operation) { return; }

        const fadeOut = () => {
            const indicator = operation.element;
            indicator.classList.remove('visible');

            setTimeout(() => {
                if (indicator.parentNode) {
                    indicator.parentNode.removeChild(indicator);
                }
                this.activeOperations.delete(operationId);
            }, 400);
        };

        if (immediate) {
            fadeOut();
        } else {
            // Brief delay to show completion
            setTimeout(fadeOut, 200);
        }
    }

    // Clean up all active operations
    clear() {
        for (const operationId of this.activeOperations.keys()) {
            this.endOperation(operationId, true);
        }
    }

}

// Create singleton instance
const activityManager = new ActivityIndicatorManager();

// Global window exposure
if (typeof window !== 'undefined') {
    window.ActivityIndicatorManager = ActivityIndicatorManager;
    window.activityManager = activityManager;
}