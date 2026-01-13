/**
 * Modal and Dialog Management Utilities
 * Centralizes all modal, dialog, and popup functionality
 */

class ModalUtils {
    constructor() {
        this.activeModals = new Set();
        this.keyHandlers = new Map();
        this.setupGlobalKeyHandler();
    }

    /**
     * Setup global key handler for modal management
     */
    setupGlobalKeyHandler() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.activeModals.size > 0) {
                this.closeTopModal();
            }
        });
    }

    /**
     * Show input modal using existing HTML elements
     * @param {string} title - Modal title
     * @param {string} message - Modal message
     * @param {string} placeholder - Input placeholder
     * @param {Function} onConfirm - Callback when confirmed
     * @param {Function} onCancel - Optional callback when cancelled
     */
    showInputModal(title, message, placeholder, onConfirm, onCancel = null, options = {}) {
        const modalElement = document.getElementById('input-modal');
        if (!modalElement) {
            console.error('Input modal element not found');
            return;
        }

        const {
            defaultValue = '',
            validate = null
        } = options || {};

        // Set up modal content
        document.getElementById('input-modal-title').textContent = title;
        document.getElementById('input-modal-message').textContent = message;

        const inputField = document.getElementById('input-modal-field');
        inputField.placeholder = placeholder;
        inputField.value = defaultValue;

        const errorElement = document.getElementById('input-modal-error');
        if (errorElement) {
            errorElement.textContent = '';
            errorElement.style.display = 'none';
        }

        // Show modal
        modalElement.style.display = 'flex';
        this.activeModals.add(modalElement);

        // Focus input after a brief delay
        setTimeout(() => inputField.focus(), 100);

        // Set up confirm action
        const confirmAction = () => {
            const value = inputField.value.trim();
            if (value) {
                if (typeof validate === 'function') {
                    const error = validate(value);
                    if (error) {
                        if (errorElement) {
                            errorElement.textContent = error;
                            errorElement.style.display = 'block';
                        }
                        return;
                    }
                }
                this.closeInputModal();
                onConfirm(value);
            }
        };

        // Set up cancel action
        const cancelAction = () => {
            this.closeInputModal();
            if (onCancel) onCancel();
        };

        // Bind events
        const okBtn = document.getElementById('input-ok-btn');
        const cancelBtn = document.getElementById('input-cancel-btn');

        // Remove previous listeners to avoid duplicates
        okBtn.onclick = null;
        inputField.onkeydown = null;
        if (cancelBtn) cancelBtn.onclick = null;

        // Add new listeners
        okBtn.onclick = confirmAction;
        if (cancelBtn) cancelBtn.onclick = cancelAction;

        inputField.onkeydown = (e) => {
            if (e.key === 'Enter') {
                confirmAction();
            } else if (e.key === 'Escape') {
                cancelAction();
            }
        };

        // Store handlers for cleanup
        this.keyHandlers.set(modalElement, { confirmAction, cancelAction });
    }

    /**
     * Close input modal
     */
    closeInputModal() {
        const modalElement = document.getElementById('input-modal');
        if (modalElement) {
            modalElement.style.display = 'none';
            this.activeModals.delete(modalElement);
            this.keyHandlers.delete(modalElement);
        }
    }

    /**
     * Cancel input modal and invoke its cancel handler if present
     */
    cancelInputModal() {
        const modalElement = document.getElementById('input-modal');
        if (!modalElement) {
            return;
        }

        const handlers = this.keyHandlers.get(modalElement);
        if (handlers && typeof handlers.cancelAction === 'function') {
            handlers.cancelAction();
            return;
        }

        this.closeInputModal();
    }

    /**
     * Create and show a custom confirmation modal
     * CSS styles are in webview.css under "Custom Modal Dialogs" section
     * @param {string} title - Modal title
     * @param {string} message - Modal message
     * @param {Array} buttons - Array of button objects {text, action, primary, variant}
     * @param {Object} options - Additional options {maxWidth, closeOnOutsideClick}
     */
    showConfirmModal(title, message, buttons = [], options = {}) {
        const {
            maxWidth = '400px',
            closeOnOutsideClick = true,
            className = 'custom-modal'
        } = options;

        // Create modal overlay - styles in webview.css
        const modal = document.createElement('div');
        modal.className = `modal ${className}`;

        // Create dialog - styles in webview.css
        const dialog = document.createElement('div');
        dialog.className = 'modal-dialog';
        if (maxWidth !== '400px') {
            dialog.style.maxWidth = maxWidth;
        }

        // Create content
        const titleElement = document.createElement('h3');
        titleElement.className = 'modal-dialog-title';
        titleElement.textContent = title;

        const messageElement = document.createElement('p');
        messageElement.className = 'modal-dialog-message';
        messageElement.textContent = message;

        // Create button container
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'modal-dialog-buttons';

        // Create buttons
        buttons.forEach((buttonConfig) => {
            const button = document.createElement('button');
            button.className = 'modal-dialog-btn';
            button.textContent = buttonConfig.text;
            if (buttonConfig.disabled) {
                button.disabled = true;
            }

            // Apply button variant via class
            if (buttonConfig.primary || buttonConfig.variant === 'primary') {
                button.classList.add('primary');
            } else if (buttonConfig.variant === 'danger') {
                button.classList.add('danger');
            }

            // Add click handler
            button.onclick = () => {
                if (button.disabled) { return; }
                this.closeModal(modal);
                if (buttonConfig.action) {
                    buttonConfig.action();
                }
            };

            buttonContainer.appendChild(button);
        });

        // Assemble dialog
        dialog.appendChild(titleElement);
        dialog.appendChild(messageElement);
        dialog.appendChild(buttonContainer);
        modal.appendChild(dialog);

        // Add to document
        document.body.appendChild(modal);
        this.activeModals.add(modal);

        // Close on outside click
        if (closeOnOutsideClick) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(modal);
                }
            });
        }

        return modal;
    }

    /**
     * Show a simple alert modal
     * @param {string} title - Alert title
     * @param {string} message - Alert message
     * @param {Function} onOk - Optional callback when OK is clicked
     */
    showAlert(title, message, onOk = null) {
        return this.showConfirmModal(title, message, [
            {
                text: 'OK',
                primary: true,
                action: onOk
            }
        ]);
    }

    /**
     * Show a simple confirm modal
     * @param {string} title - Confirm title
     * @param {string} message - Confirm message
     * @param {Function} onConfirm - Callback when confirmed
     * @param {Function} onCancel - Optional callback when cancelled
     */
    showConfirm(title, message, onConfirm, onCancel = null) {
        return this.showConfirmModal(title, message, [
            {
                text: 'Cancel',
                action: onCancel
            },
            {
                text: 'OK',
                primary: true,
                action: onConfirm
            }
        ]);
    }

    /**
     * Close a specific modal
     * @param {HTMLElement} modal - Modal element to close
     */
    closeModal(modal) {
        if (modal && modal.parentNode) {
            modal.parentNode.removeChild(modal);
            this.activeModals.delete(modal);
            this.keyHandlers.delete(modal);
        }
    }

    /**
     * Close the topmost modal
     */
    closeTopModal() {
        if (this.activeModals.size > 0) {
            const modals = Array.from(this.activeModals);
            const topModal = modals[modals.length - 1];

            // Try input modal first
            if (topModal.id === 'input-modal') {
                this.cancelInputModal();
            } else {
                this.closeModal(topModal);
            }
        }
    }


    /**
     * Show a loading modal
     * CSS styles are in webview.css under "Custom Modal Dialogs" section
     * @param {string} message - Loading message
     * @returns {HTMLElement} Modal element for later closing
     */
    showLoading(message = 'Loading...') {
        const modal = document.createElement('div');
        modal.className = 'modal loading-modal';

        const spinnerContainer = document.createElement('div');
        spinnerContainer.className = 'loading-spinner';

        const spinner = document.createElement('div');
        spinner.className = 'spinner';

        const text = document.createElement('span');
        text.textContent = message;

        spinnerContainer.appendChild(spinner);
        spinnerContainer.appendChild(text);
        modal.appendChild(spinnerContainer);

        document.body.appendChild(modal);
        this.activeModals.add(modal);

        return modal;
    }
}

// Create singleton instance
const modalUtils = new ModalUtils();

// Make it globally available for compatibility
if (typeof window !== 'undefined') {
    window.ModalUtils = ModalUtils;
    window.modalUtils = modalUtils;

    // Export individual functions for backward compatibility
    window.showInputModal = modalUtils.showInputModal.bind(modalUtils);
    window.closeInputModal = modalUtils.closeInputModal.bind(modalUtils);
    window.showAlert = modalUtils.showAlert.bind(modalUtils);
    window.showConfirm = modalUtils.showConfirm.bind(modalUtils);
    window.showLoading = modalUtils.showLoading.bind(modalUtils);
}
